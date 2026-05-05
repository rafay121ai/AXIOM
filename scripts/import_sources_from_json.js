import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  ensureSeedDirectories,
  fetchProcessedTitles,
  processSource,
} from '../seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    args[key] = value
  }
  return args
}

function normalizeSources(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.sources)) return payload.sources
  throw new Error('JSON file must contain either an array of sources or an object with a "sources" array')
}

function validateSource(source, index) {
  const locationKey = source.filePath || source.transcriptPath || source.youtubeUrl || source.arxivId || source.url
  if (!source || typeof source !== 'object') {
    throw new Error(`Source at index ${index} is not an object`)
  }
  if (!source.pillar) throw new Error(`Source at index ${index} is missing "pillar"`)
  if (!source.content_type) throw new Error(`Source at index ${index} is missing "content_type"`)
  if (!source.title) throw new Error(`Source at index ${index} is missing "title"`)
  if (!locationKey) {
    throw new Error(`Source "${source.title}" must include one of filePath, transcriptPath, youtubeUrl, arxivId, or url`)
  }
}

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY must be set in .env')
  }

  const args = parseArgs(process.argv.slice(2))
  const fileArg = String(args.file || '').trim()
  if (!fileArg) {
    throw new Error('Please provide a JSON file via --file path/to/file.json')
  }

  const fullPath = path.resolve(__dirname, '..', fileArg)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`JSON file not found: ${fileArg}`)
  }

  const payload = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
  const sources = normalizeSources(payload)
  sources.forEach(validateSource)

  await ensureSeedDirectories()
  const processedTitles = await fetchProcessedTitles()

  let imported = 0
  let skipped = 0

  console.log('─────────────────────────────────────────────────────────────')
  console.log('Manual source import starting.')
  console.log(`File   : ${fileArg}`)
  console.log(`Sources: ${sources.length}`)
  console.log('─────────────────────────────────────────────────────────────\n')

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    console.log(`[${i + 1}/${sources.length}] ${source.title}`)
    try {
      const result = await processSource(source, processedTitles)
      if (result.skipped) {
        skipped++
        console.log('  Skipped — already in DB\n')
        continue
      }
      imported++
      processedTitles.add(source.title)
      console.log(`  Imported — ${result.inserted}/${result.chunks} chunks\n`)
    } catch (err) {
      skipped++
      console.log(`  Skipped — ${err.message}\n`)
    }
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log('Manual source import complete.')
  console.log(`  Imported: ${imported}`)
  console.log(`  Skipped : ${skipped}`)
  console.log('─────────────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Fatal manual import error:', err)
  process.exit(1)
})
