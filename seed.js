/**
 * seed.js — Full RAG seed for Axiom wiki_chunks
 *
 * Pulls real source text from local PDFs, web articles, YouTube transcripts,
 * and public PDF URLs. Chunks, embeds, and inserts into Supabase.
 *
 * Run: node seed.js
 *
 * Requirements:
 *   - .env must have VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_OPENAI_API_KEY
 *   - Service role key is required (anon key won't have insert rights)
 *   - /sources/books/ directory with your PDFs
 *   - pgvector enabled and wiki_chunks table created
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
import { getSubtitles } from 'youtube-captions-scraper'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = path.join(__dirname, 'sources')

// ─── Clients ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const openai = new OpenAI({ apiKey: process.env.VITE_OPENAI_API_KEY })

// ─── Sources ─────────────────────────────────────────────────────────────────
// content_type ordering for processing: book → article → podcast →
//   financial_doc → biography → company_profile → academic_paper

const SOURCES = [
  // ══════════════════════════════════════════════════════════════════════════
  // MONEY GAME — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'money_game', content_type: 'book',
    title: 'The Psychology of Money', author: 'Morgan Housel',
    filePath: 'money_game/books/psychology-of-money.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'The Almanack of Naval Ravikant', author: 'Eric Jorgenson',
    filePath: 'money_game/books/almanack-naval-ravikant.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Changing World Order', author: 'Ray Dalio',
    filePath: 'money_game/books/changing-world-order.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Zero to One', author: 'Peter Thiel',
    filePath: 'money_game/books/zero-to-one.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'The Millionaire Next Door', author: 'Stanley & Danko',
    filePath: 'money_game/books/millionaire-next-door.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Principles', author: 'Ray Dalio',
    filePath: 'money_game/books/principles-ray-dalio.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'The Richest Man in Babylon', author: 'George Clason',
    filePath: 'money_game/books/richest-man-babylon.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: "Poor Charlie's Almanack", author: 'Charlie Munger',
    filePath: 'money_game/books/poor-charlies-almanack.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'The Intelligent Investor', author: 'Benjamin Graham',
    filePath: 'money_game/books/intelligent-investor.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Rich Dad Poor Dad', author: 'Robert Kiyosaki',
    filePath: 'money_game/books/rich-dad-poor-dad.pdf',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'Principles For Success — Ray Dalio Summary', author: 'Ray Dalio',
    url: 'https://www.grahammann.net/book-notes/principles-ray-dalio',
  },

  // MONEY GAME — Articles
  {
    pillar: 'money_game', content_type: 'article',
    title: 'How to Make Wealth', author: 'Paul Graham',
    url: 'https://paulgraham.com/wealth.html',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'Default Alive or Default Dead', author: 'Paul Graham',
    url: 'https://paulgraham.com/aord.html',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: "Do Things That Don't Scale", author: 'Paul Graham',
    url: 'https://paulgraham.com/ds.html',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'How to Get Rich — Naval Ravikant', author: 'Naval Ravikant',
    url: 'https://paulgraham.com/wealth.html',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'Naval Ravikant on Wealth and Happiness', author: 'Naval Ravikant',
    url: 'https://nav.al/work',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'Principles for Navigating Big Debt Crises', author: 'Ray Dalio',
    url: 'https://www.principles.com/big-debt-crises/',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: '1000 True Fans', author: 'Kevin Kelly',
    url: 'https://kk.org/thetechnium/1000-true-fans/',
  },
  {
    pillar: 'money_game', content_type: 'article',
    title: 'The Psychology of Money (original essay)', author: 'Morgan Housel',
    url: 'https://www.collaborativefund.com/blog/the-psychology-of-money/',
  },

  // MONEY GAME — Podcasts
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'Acquired — LVMH Episode', author: 'Ben Gilbert & David Rosenthal',
    transcriptPath: './sources/transcripts/acquired-lvmh.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'Acquired — Berkshire Hathaway Episode', author: 'Ben Gilbert & David Rosenthal',
    transcriptPath: './sources/transcripts/acquired-berkshire.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'My First Million — How to Get Rich Without Getting Lucky', author: 'Sam Parr & Shaan Puri',
    transcriptPath: './sources/transcripts/mfm-get-rich.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'Founders Podcast — Rockefeller Episode', author: 'David Senra',
    transcriptPath: './sources/transcripts/founders-rockefeller.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'Invest Like the Best — Spotifys Journey To Profitability', author: 'Patrick OShaughnessy',
    transcriptPath: './sources/transcripts/invest-like-best-spotify.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'We Study Billionaires — Warren Buffett', author: 'The Investors Podcast',
    transcriptPath: './sources/transcripts/we-study-billionaires-buffett.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'How I Built This — Sara Blakely Spanx', author: 'Guy Raz',
    transcriptPath: './sources/transcripts/how-i-built-this-sara-blakely.txt',
  },
  {
    pillar: 'money_game', content_type: 'podcast',
    title: 'Plain English — Economics of AI', author: 'Derek Thompson',
    transcriptPath: './sources/transcripts/plain-english-ai-economics.txt',
  },

  // MONEY GAME — Financial Docs (public PDF or HTML)
  {
    pillar: 'money_game', content_type: 'financial_doc',
    title: 'Berkshire Hathaway Annual Letter 2023', author: 'Warren Buffett',
    url: 'https://www.berkshirehathaway.com/letters/2023ltr.pdf',
  },
  {
    pillar: 'money_game', content_type: 'financial_doc',
    title: 'Berkshire Hathaway Annual Letter 2022', author: 'Warren Buffett',
    url: 'https://www.berkshirehathaway.com/letters/2022ltr.pdf',
  },
  {
    pillar: 'money_game', content_type: 'financial_doc',
    title: 'Amazon 2022 Shareholder Letter', author: 'Andy Jassy',
    url: 'https://s2.q4cdn.com/299287126/files/doc_financials/2023/ar/Amazon-2022-Annual-Report.pdf',
  },
  {
    pillar: 'money_game', content_type: 'case_study',
    title: 'WeWork S-1 Analysis — The Downfall', author: 'Matthew Zeitlin',
    url: 'https://www.theguardian.com/business/2019/sep/17/wework-ipo-adam-neumann',
  },
  {
    pillar: 'money_game', content_type: 'case_study',
    title: 'Theranos — The Full Fraud Story', author: 'Bad Blood Summary',
    url: 'https://www.bbc.com/news/business-58336998',
  },
  {
    pillar: 'money_game', content_type: 'case_study',
    title: 'FTX Collapse — Sam Bankman-Fried Story', author: 'Financial Times',
    url: 'https://www.theguardian.com/technology/2022/nov/10/what-is-ftx-and-why-has-it-collapsed',
  },
  {
    pillar: 'money_game', content_type: 'financial_doc',
    title: 'Systems Limited Annual Report 2024', author: 'Systems Limited',
    url: 'https://www.systemsltd.com/sites/default/files/2025-04/Annual%20Report-%202024%20-%20Systems%20Limited..pdf',
  },

  // MONEY GAME — Biographies
  {
    pillar: 'money_game', content_type: 'biography',
    title: 'Titan', author: 'Ron Chernow',
    filePath: 'money_game/biographies/titan-rockefeller.pdf',
  },
  {
    pillar: 'money_game', content_type: 'biography',
    title: 'Shoe Dog', author: 'Phil Knight',
    filePath: 'money_game/biographies/shoe-dog.pdf',
  },
  {
    pillar: 'money_game', content_type: 'biography',
    title: 'The Everything Store', author: 'Brad Stone',
    filePath: 'money_game/biographies/everything-store.pdf',
  },
  {
    pillar: 'money_game', content_type: 'biography',
    title: 'Made in America', author: 'Sam Walton',
    filePath: 'money_game/biographies/made-in-america-walton.pdf',
  },
  {
    pillar: 'money_game', content_type: 'biography',
    title: 'The Snowball', author: 'Alice Schroeder',
    filePath: 'money_game/biographies/snowball-buffett.pdf',
  },

  // MONEY GAME — Company Profiles
  {
    pillar: 'money_game', content_type: 'company_profile',
    title: 'Netflix Culture Deck', author: 'Reed Hastings',
    url: 'https://jobs.netflix.com/culture',
  },
  {
    pillar: 'money_game', content_type: 'company_profile',
    title: 'Stripe Payment API Design', author: 'Stripe',
    url: 'https://stripe.com/blog/payment-api-design',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HUMAN MIND — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'Thinking Fast and Slow', author: 'Daniel Kahneman',
    filePath: 'human_mind/books/thinking-fast-and-slow.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'The War of Art', author: 'Steven Pressfield',
    filePath: 'human_mind/books/war-of-art.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'Atomic Habits', author: 'James Clear',
    filePath: 'human_mind/books/atomic-habits.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: "Man's Search for Meaning", author: 'Viktor Frankl',
    filePath: 'human_mind/books/mans-search-for-meaning.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'The Courage to Be Disliked', author: 'Kishimi & Koga',
    filePath: 'human_mind/books/courage-to-be-disliked.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'Influence', author: 'Robert Cialdini',
    filePath: 'human_mind/books/influence-cialdini.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'Predictably Irrational', author: 'Dan Ariely',
    filePath: 'human_mind/books/predictably-irrational.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'Mindset', author: 'Carol Dweck',
    filePath: 'human_mind/books/mindset-dweck.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: "Can't Hurt Me", author: 'David Goggins',
    filePath: 'human_mind/books/cant-hurt-me.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'The Body Keeps the Score', author: 'Bessel van der Kolk',
    filePath: 'human_mind/books/body-keeps-score.pdf',
  },

  // HUMAN MIND — Articles
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'This Is Water', author: 'David Foster Wallace',
    url: 'https://jamesclear.com/great-speeches/this-is-water-by-david-foster-wallace',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'The Tail End', author: 'Tim Urban',
    url: 'https://waitbutwhy.com/2015/12/the-tail-end.html',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'Your Life in Weeks', author: 'Tim Urban',
    url: 'https://waitbutwhy.com/2014/05/life-weeks.html',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'Solitude and Leadership', author: 'William Deresiewicz',
    url: 'https://fs.blog/solitude-and-leadership/',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'Keep Your Identity Small', author: 'Paul Graham',
    url: 'https://paulgraham.com/identity.html',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'Why Procrastinators Procrastinate', author: 'Tim Urban',
    url: 'https://waitbutwhy.com/2013/10/why-procrastinators-procrastinate.html',
  },
  {
    pillar: 'human_mind', content_type: 'article',
    title: 'Mental Models', author: 'Shane Parrish',
    url: 'https://jamesclear.com/mental-models',
  },

  // HUMAN MIND — Podcasts
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Huberman Lab — Dopamine and Motivation', author: 'Andrew Huberman',
    youtubeUrl: 'https://www.youtube.com/watch?v=QmOF0crdyRU',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Huberman Lab — Master Your Sleep', author: 'Andrew Huberman',
    youtubeUrl: 'https://www.youtube.com/watch?v=nm1TxQj9IsQ',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Hidden Brain — You 2.0 Reframing', author: 'Shankar Vedantam',
    youtubeUrl: 'https://www.youtube.com/watch?v=rcp5UPFin_Q',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Tim Ferriss — Matt Mullenweg on Solitude', author: 'Tim Ferriss',
    youtubeUrl: 'https://www.youtube.com/watch?v=sf5fMooyBGU',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'The Diary of a CEO — James Clear on Atomic Habits', author: 'Steven Bartlett',
    youtubeUrl: 'https://www.youtube.com/watch?v=PZ7lDrwYdZc',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Ten Percent Happier — Dan Harris on Meditation', author: 'Dan Harris',
    youtubeUrl: 'https://www.youtube.com/watch?v=nYuKqbfCEGY',
  },
  {
    pillar: 'human_mind', content_type: 'podcast',
    title: 'Lex Fridman — Robert Sapolsky on Human Behavior', author: 'Lex Fridman',
    youtubeUrl: 'https://www.youtube.com/watch?v=Y0Oa4Lp5fLE',
  },

  // HUMAN MIND — Biographies
  {
    pillar: 'human_mind', content_type: 'biography',
    title: "Can't Hurt Me", author: 'David Goggins',
    filePath: 'human_mind/biographies/cant-hurt-me.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'biography',
    title: 'Open', author: 'Andre Agassi',
    filePath: 'human_mind/biographies/open-agassi.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'biography',
    title: 'Educated', author: 'Tara Westover',
    filePath: 'human_mind/biographies/educated-westover.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'biography',
    title: "Surely You're Joking Mr Feynman", author: 'Richard Feynman',
    filePath: 'human_mind/biographies/feynman-joking.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'biography',
    title: 'When Breath Becomes Air', author: 'Paul Kalanithi',
    filePath: 'human_mind/biographies/when-breath-becomes-air.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'biography',
    title: 'Long Walk to Freedom', author: 'Nelson Mandela',
    filePath: 'human_mind/biographies/long-walk-to-freedom.pdf',
  },

  // HUMAN MIND — Company / Culture Profiles
  {
    pillar: 'human_mind', content_type: 'company_profile',
    title: 'Netflix Culture Deck', author: 'Reed Hastings',
    url: 'https://jobs.netflix.com/culture',
  },
  {
    pillar: 'human_mind', content_type: 'company_profile',
    title: 'Bridgewater Principles', author: 'Ray Dalio',
    url: 'https://www.principles.com',
  },
  {
    pillar: 'human_mind', content_type: 'company_profile',
    title: 'Google Project Aristotle', author: 'Google re:Work',
    url: 'https://www.nytimes.com/2016/02/28/magazine/what-google-learned-from-its-quest-to-build-the-perfect-team.html',
  },
  {
    pillar: 'human_mind', content_type: 'company_profile',
    title: 'IDEO Design Thinking', author: 'IDEO',
    url: 'https://designthinking.ideo.com/',
  },

  // HUMAN MIND — Academic Papers
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Milgram Obedience Experiment', author: 'Stanley Milgram',
    url: 'https://www.verywellmind.com/the-milgram-obedience-experiment-2795243',
  },
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Growth Mindset Research', author: 'Carol Dweck',
    url: 'https://www.mindsetworks.com/science/',
  },
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Flow State Research', author: 'Mihaly Csikszentmihalyi',
    url: 'https://positivepsychology.com/mihaly-csikszentmihalyi-father-of-flow/',
  },
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Deliberate Practice', author: 'Anders Ericsson',
    url: 'https://fs.blog/deliberate-practice-definition/',
  },
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Learned Helplessness', author: 'Martin Seligman',
    url: 'https://www.verywellmind.com/what-is-learned-helplessness-2795326',
  },
  {
    pillar: 'human_mind', content_type: 'academic_paper',
    title: 'Prospect Theory', author: 'Kahneman & Tversky',
    url: 'https://www.behavioraleconomics.com/resources/mini-encyclopedia-of-be/prospect-theory/',
  },
]

// ─── Chunking ─────────────────────────────────────────────────────────────────
// 450 words per chunk, 50-word overlap (slide 400 words), skip < 100 chars

function sanitizeText(text) {
  return text
    .replace(/\u0000/g, '')                                             // null bytes
    .replace(/[\u0080-\u009F]/g, '')                                    // control characters
    .replace(/\uFFFD/g, '')                                             // replacement character
    .replace(/\\u[0-9a-fA-F]{4}/g, '')                                  // escaped unicode sequences
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD]/g, '') // anything outside safe unicode ranges
    .trim()
}

function chunkText(text) {
  const CHUNK_WORDS = 450
  const SLIDE_WORDS = 400  // step between chunk starts (overlap = 50 words)
  const MIN_CHARS = 100

  // Sanitize then normalise whitespace
  const cleaned = sanitizeText(text).replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ')
  const chunks = []

  for (let i = 0; i < words.length; i += SLIDE_WORDS) {
    const slice = words.slice(i, i + CHUNK_WORDS).join(' ')
    if (slice.length >= MIN_CHARS) chunks.push(slice)
    if (i + CHUNK_WORDS >= words.length) break
  }

  return chunks
}

// ─── Source Processors ───────────────────────────────────────────────────────

function processTranscript(transcriptPath) {
  const fullPath = path.resolve(__dirname, transcriptPath)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`)
  }
  return fs.readFileSync(fullPath, 'utf-8')
}

async function processLocalPDF(filePath) {
  const fullPath = path.join(SOURCES_DIR, filePath)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}, skipping`)
  }
  const buffer = fs.readFileSync(fullPath)
  const data = await pdfParse(buffer)
  return data.text
}

async function processURL(url) {
  let response
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: () => true,  // never throw on status — we check manually below
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
      },
      maxRedirects: 5,
    })
  } catch (err) {
    throw new Error(`Failed to fetch ${url}: ${err.message}`)
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }

  const contentType = (response.headers['content-type'] || '').toLowerCase()
  const isPDF =
    contentType.includes('application/pdf') ||
    contentType.includes('application/octet-stream') ||
    url.toLowerCase().endsWith('.pdf')

  if (isPDF) {
    const data = await pdfParse(Buffer.from(response.data))
    return data.text
  }

  // HTML — parse with cheerio
  const html = Buffer.from(response.data).toString('utf-8')
  const $ = cheerio.load(html)

  // Strip noise elements
  $(
    'script, style, nav, footer, header, aside, iframe, noscript, ' +
    '.sidebar, .menu, .navigation, .ad, .advertisement, .banner, ' +
    '.cookie, .modal, .popup, .newsletter, .related, .comments, ' +
    '[class*="sidebar"], [class*="widget"], [id*="sidebar"], ' +
    '[class*="nav"], [class*="footer"], [class*="header"]'
  ).remove()

  // Try to find main content container
  const candidates = [
    'article', 'main', '[role="main"]',
    '.post-content', '.entry-content', '.article-content', '.content-body',
    '.prose', '#content', '.post', '.article', '.page-content',
  ]

  let text = ''
  for (const selector of candidates) {
    const el = $(selector).first()
    if (el.length && el.text().trim().length > 300) {
      text = el.text()
      break
    }
  }

  // Fallback: full body
  if (!text || text.trim().length < 300) {
    text = $('body').text()
  }

  return text
}

async function processYouTube(youtubeUrl) {
  // Extract video ID from any YouTube URL format
  const match = youtubeUrl.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  if (!match) throw new Error(`Could not extract video ID from: ${youtubeUrl}`)

  const videoId = match[1]
  let segments

  try {
    segments = await getSubtitles({ videoID: videoId, lang: 'en' })
  } catch (err) {
    throw new Error(`Transcript unavailable for ${youtubeUrl}: ${err.message}`)
  }

  if (!segments || segments.length === 0) {
    throw new Error(`Transcript unavailable for ${youtubeUrl}: empty response`)
  }

  return segments.map((s) => s.text).join(' ')
}

// ─── Embedding + Insert ───────────────────────────────────────────────────────

async function embedAndInsert(source, chunks) {
  let inserted = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = sanitizeText(chunks[i]).slice(0, 8000)  // OpenAI input limit

    // Embed
    let embedding
    try {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunkText,
      })
      embedding = res.data[0].embedding
    } catch (err) {
      console.error(`    Embedding failed for chunk ${i + 1}: ${err.message}`)
      continue
    }

    // Insert
    const { error } = await supabase.from('wiki_chunks').insert({
      pillar: source.pillar,
      content_type: source.content_type,
      title: source.title,
      author: source.author,
      key_frameworks: chunkText,
      embedding,
    })

    if (error) {
      console.error(`    Insert failed for chunk ${i + 1}: ${error.message}`)
    } else {
      inserted++
    }

    process.stdout.write(`\r    Inserted ${inserted}/${chunks.length} chunks for "${source.title}"`)
    await new Promise((r) => setTimeout(r, 100))
  }

  process.stdout.write('\n')
  return inserted
}

// ─── Process Single Source ────────────────────────────────────────────────────

async function processSource(source, processedTitles) {
  if (processedTitles.has(source.title)) {
    console.log(`    SKIPPING — already in DB: "${source.title}"`)
    return { chunks: 0, inserted: 0, skipped: true }
  }

  let rawText

  if (source.filePath) {
    rawText = await processLocalPDF(source.filePath)
  } else if (source.transcriptPath) {
    rawText = processTranscript(source.transcriptPath)
  } else if (source.youtubeUrl) {
    rawText = await processYouTube(source.youtubeUrl)
  } else if (source.url) {
    rawText = await processURL(source.url)
  } else {
    throw new Error('Source has no filePath, transcriptPath, youtubeUrl, or url')
  }

  if (!rawText || rawText.trim().length < 500) {
    throw new Error(`Extracted text too short (${rawText?.trim().length ?? 0} chars) — likely a paywall, redirect, or empty page`)
  }

  const chunks = chunkText(rawText)
  if (chunks.length === 0) throw new Error('No usable chunks extracted')

  const inserted = await embedAndInsert(source, chunks)
  return { chunks: chunks.length, inserted }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─────────────────────────────────────────────────────────────')
  console.log('Axiom seed starting.')
  console.log('Make sure /sources/books/ exists and your PDFs are named correctly.')
  console.log('Service role key required — not anon key.')
  console.log('─────────────────────────────────────────────────────────────\n')

  // Validate env
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
    process.exit(1)
  }
  if (!process.env.VITE_OPENAI_API_KEY) {
    console.error('ERROR: VITE_OPENAI_API_KEY must be set in .env')
    process.exit(1)
  }

  // Ensure /sources/ and /sources/transcripts/ exist
  const TRANSCRIPTS_DIR = path.join(SOURCES_DIR, 'transcripts')
  for (const dir of [SOURCES_DIR, TRANSCRIPTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`Created ${dir}\n`)
    }
  }

  // Fetch all titles already in DB — used to skip re-processing on re-runs
  // Paginate through all existing titles — Supabase default cap is 1000 rows per query
  const processedTitles = new Set()
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data: page, error: fetchError } = await supabase
      .from('wiki_chunks')
      .select('title')
      .range(offset, offset + PAGE - 1)
    if (fetchError) {
      console.error('ERROR: Could not fetch existing titles:', fetchError.message)
      process.exit(1)
    }
    if (!page || page.length === 0) break
    page.forEach((r) => processedTitles.add(r.title))
    if (page.length < PAGE) break
    offset += PAGE
  }
  console.log(`Found ${processedTitles.size} unique title(s) already in DB.\n`)

  // Order: money_game first, then human_mind
  // Within each pillar: book → article → podcast → financial_doc → biography → company_profile → academic_paper
  const TYPE_ORDER = ['book', 'article', 'podcast', 'financial_doc', 'case_study', 'biography', 'company_profile', 'academic_paper']
  const PILLAR_ORDER = ['money_game', 'human_mind']

  const ordered = [...SOURCES].sort((a, b) => {
    const pillarDiff = PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar)
    if (pillarDiff !== 0) return pillarDiff
    const typeDiff = (TYPE_ORDER.indexOf(a.content_type) ?? 99) - (TYPE_ORDER.indexOf(b.content_type) ?? 99)
    return typeDiff
  })

  const total = ordered.length
  let sourcesSucceeded = 0
  let sourcesFailed = 0
  let totalChunksInserted = 0

  for (let i = 0; i < ordered.length; i++) {
    const source = ordered[i]
    const sourceType = source.filePath ? 'pdf' : source.transcriptPath ? 'transcript' : source.youtubeUrl ? 'youtube' : 'url'
    console.log(`[${i + 1}/${total}] Processing: ${source.title} (${source.content_type}) [${sourceType}]`)

    try {
      const { chunks, inserted, skipped } = await processSource(source, processedTitles)
      if (!skipped) {
        console.log(`    Done. ${inserted}/${chunks} chunks inserted.\n`)
        sourcesSucceeded++
        totalChunksInserted += inserted
      }
    } catch (err) {
      console.log(`    SKIPPED — ${err.message}\n`)
      sourcesFailed++
    }
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log('Seed complete.')
  console.log(`  Sources attempted : ${total}`)
  console.log(`  Sources succeeded : ${sourcesSucceeded}`)
  console.log(`  Sources skipped   : ${sourcesFailed}`)
  console.log(`  Total chunks      : ${totalChunksInserted}`)
  console.log('─────────────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
