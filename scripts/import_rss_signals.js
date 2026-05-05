import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import {
  ensureSeedDirectories,
  fetchProcessedTitles,
  processSource,
} from '../seed.js'

const DEFAULT_PER_FEED_LIMIT = Number(process.env.RSS_PER_FEED_LIMIT || 5)
const RSS_FEEDS = [
  {
    pillar: 'whats_coming',
    author: 'Carbon Brief',
    feedUrl: 'https://www.carbonbrief.org/feed/',
  },
  {
    pillar: 'whats_coming',
    author: 'Canary Media',
    feedUrl: 'https://www.canarymedia.com/feed',
  },
  {
    pillar: 'whats_coming',
    author: 'Heatmap News',
    feedUrl: 'https://heatmap.news/feed',
  },
  {
    pillar: 'whats_coming',
    author: 'Latitude Media',
    feedUrl: 'https://www.latitudemedia.com/feed',
  },
  {
    pillar: 'whats_coming',
    author: 'Utility Dive',
    feedUrl: 'https://www.utilitydive.com/feeds/news/',
  },
]

function cleanText(value, fallback = '') {
  return decodeXmlEntities(String(value || '')).replace(/\s+/g, ' ').trim() || fallback
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeDate(value) {
  const raw = cleanText(value)
  if (!raw) return null

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function buildSourceFromRssItem(feed, item) {
  const title = cleanText(item.title || item.summary || 'Untitled RSS item')
  const link = cleanText(item.link)
  if (!link) return null

  return {
    pillar: feed.pillar,
    content_type: 'article',
    title,
    author: cleanText(item.author || feed.author, feed.author),
    url: link,
    published_at: normalizeDate(item.published || item.updated),
  }
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#124;/g, '|')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
}

function stripXmlTags(value) {
  return decodeXmlEntities(value).replace(/<[^>]+>/g, ' ')
}

function extractTag(block, tagNames) {
  for (const tag of tagNames) {
    const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
    const match = block.match(pattern)
    if (match) return cleanText(stripXmlTags(match[1]))
  }
  return ''
}

function parseFeedItems(xml) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0])
  if (rssItems.length > 0) {
    return rssItems.map((item) => ({
      title: extractTag(item, ['title']),
      link: extractTag(item, ['link']),
      author: extractTag(item, ['dc:creator', 'author']),
      summary: extractTag(item, ['description', 'content:encoded']),
      published: extractTag(item, ['pubDate', 'dc:date', 'published', 'updated']),
    }))
  }

  const atomEntries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0])
  return atomEntries.map((entry) => {
    const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i)
    return {
      title: extractTag(entry, ['title']),
      link: cleanText(decodeXmlEntities(linkMatch?.[1] || '')),
      author: extractTag(entry, ['name', 'author']),
      summary: extractTag(entry, ['summary', 'content']),
      published: extractTag(entry, ['published', 'updated']),
    }
  })
}

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const xml = await response.text()
  return { items: parseFeedItems(xml) }
}

async function fetchExistingSourceUrls(supabase) {
  const urls = new Set()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('wiki_sources')
      .select('source_url')
      .not('source_url', 'is', null)
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw new Error(`Could not fetch existing source URLs: ${error.message}`)
    }

    if (!data || data.length === 0) break
    data.forEach((row) => {
      if (row.source_url) urls.add(row.source_url)
    })

    if (data.length < pageSize) break
    offset += pageSize
  }

  return urls
}

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY must be set in .env')
  }

  await ensureSeedDirectories()

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const processedTitles = await fetchProcessedTitles()
  const processedUrls = await fetchExistingSourceUrls(supabase)

  let attempted = 0
  let imported = 0
  let skipped = 0

  console.log('─────────────────────────────────────────────────────────────')
  console.log('RSS import starting for whats_coming.')
  console.log(`Feeds configured: ${RSS_FEEDS.length}`)
  console.log('─────────────────────────────────────────────────────────────\n')

  for (const feed of RSS_FEEDS) {
    console.log(`Feed: ${feed.author} — ${feed.feedUrl}`)
    let rss
    try {
      rss = await fetchFeed(feed.feedUrl)
    } catch (err) {
      console.log(`  Skipped feed — ${err.message}\n`)
      continue
    }

    const items = Array.isArray(rss.items) ? rss.items.slice(0, DEFAULT_PER_FEED_LIMIT) : []
    const candidates = unique(
      items
        .map((item) => buildSourceFromRssItem(feed, item))
        .filter(Boolean)
        .map((item) => JSON.stringify(item))
    ).map((item) => JSON.parse(item))

    for (const source of candidates) {
      attempted++

      if (processedTitles.has(source.title) || processedUrls.has(source.url)) {
        console.log(`  SKIPPING — already ingested: ${source.title}`)
        skipped++
        continue
      }

      try {
        const result = await processSource(source, processedTitles)
        if (!result.skipped) {
          imported++
          processedTitles.add(source.title)
          processedUrls.add(source.url)
          console.log(`  Imported — ${source.title} (${result.inserted}/${result.chunks} chunks)`)
        }
      } catch (err) {
        skipped++
        console.log(`  SKIPPED — ${source.title}: ${err.message}`)
      }
    }

    console.log('')
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log('RSS import complete.')
  console.log(`  Articles attempted : ${attempted}`)
  console.log(`  Articles imported  : ${imported}`)
  console.log(`  Articles skipped   : ${skipped}`)
  console.log('─────────────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Fatal RSS import error:', err)
  process.exit(1)
})
