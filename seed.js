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
import { fileURLToPath, pathToFileURL } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = path.join(__dirname, 'sources')
const execFileAsync = promisify(execFile)
const SOURCE_ENRICHMENT_MODEL = process.env.OPENAI_SOURCE_ENRICH_MODEL || 'gpt-5.4-mini-2026-03-17'
const SOURCE_ENRICHMENT_VERSION = 'wiki_sources_v1'
const TIME_HORIZONS = new Set(['immediate', 'near_term', 'medium_term', 'long_term', 'timeless'])
const SIGNAL_TYPES = new Set([
  'capability_shift',
  'distribution_shift',
  'capital_flow',
  'behavior_change',
  'policy_shift',
  'infrastructure_bottleneck',
  'market_structure',
])
const JINA_READER_BASE_URL = process.env.JINA_READER_BASE_URL || 'https://r.jina.ai/http://'

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
  {
    pillar: 'money_game', content_type: 'academic_paper',
    title: 'Efficient Capital Markets: A Review of Theory and Empirical Work',
    author: 'Eugene Fama',
    url: 'https://datagolf.com/static/blogs/fl_bias/fama_1970.pdf',
  },
  {
    pillar: 'money_game', content_type: 'academic_paper',
    title: 'The Fall of the Labor Share and the Rise of Superstar Firms',
    author: 'Autor, Dorn, Katz, Patterson & Van Reenen',
    url: 'https://www.nber.org/system/files/working_papers/w23396/w23396.pdf',
  },
  {
    pillar: 'money_game', content_type: 'academic_paper',
    title: 'Corporate Culture: Evidence from the Field',
    author: 'Graham, Harvey, Popadak & Rajgopal',
    url: 'https://www.nber.org/system/files/working_papers/w23255/w23255.pdf',
  },
  {
    pillar: 'money_game', content_type: 'academic_paper',
    title: 'Measuring Corporate Culture Using Machine Learning',
    author: 'Li, Mai, Shen & Yan',
    url: 'https://www.fengmai.net/download/manuscripts/LiMaiShenYan2021_Measuring%20Corporate%20Culture%20Using%20Machine%20Learning-RFS.pdf',
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

  // ══════════════════════════════════════════════════════════════════════════
  // MONEY GAME — Additions
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Security Analysis', author: 'Benjamin Graham',
    filePath: 'money_game/books/Security Analysis.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Common Stocks and Uncommon Profits', author: 'Philip Fisher',
    filePath: 'money_game/books/Common Stocks and Uncommon Profits.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: "Where Are the Customers' Yachts", author: 'Fred Schwed',
    filePath: "money_game/books/Where Are the Customers' Yachts.pdf",
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Money Masters of Our Time', author: 'John Train',
    filePath: 'money_game/books/Money Masters of Our Time.pdf',
  },
  {
    pillar: 'money_game', content_type: 'book',
    title: 'Business Adventures', author: 'John Brooks',
    filePath: 'money_game/books/Business Adventures.pdf',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HUMAN MIND — Additions
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'The Laws Of Human Nature', author: 'Robert Greene',
    filePath: 'move_people/books/The Laws Of Human Nature.pdf',
  },
  {
    pillar: 'human_mind', content_type: 'book',
    title: 'The Art Of Seduction', author: 'Robert Greene',
    filePath: 'move_people/books/The Art Of Seduction.pdf',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HOW COMPANIES WIN — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'High Output Management', author: 'Andrew Grove',
    filePath: 'how_companies_win/books/High Output Management.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'Crossing the Chasm', author: 'Geoffrey Moore',
    filePath: 'how_companies_win/books/Crossing the Chasm.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'The Lean Startup', author: 'Eric Ries',
    filePath: 'how_companies_win/books/The Lean Startup.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'High Growth Handbook', author: 'Elad Gil',
    filePath: 'how_companies_win/books/High Growth Handbook.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'Good to Great', author: 'Jim Collins',
    filePath: 'how_companies_win/books/Good to Great.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: "The Innovator's Dilemma", author: 'Clayton Christensen',
    filePath: 'how_companies_win/books/The Innovators Dillema.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: '7 Powers: The Foundations of Business Strategy', author: 'Hamilton Helmer',
    filePath: 'how_companies_win/books/7 Powers - The Foundations of Business Strategy.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'No Rules Rules', author: 'Reed Hastings and Erin Meyer',
    filePath: 'how_companies_win/books/No Rules Rules.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'Scaling Up', author: 'Verne Harnish',
    filePath: 'how_companies_win/books/Scaling Up.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'The E-Myth Revisited', author: 'Michael Gerber',
    filePath: 'how_companies_win/books/The E-Myth Revisited.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'The Hard Thing About Hard Things', author: 'Ben Horowitz',
    filePath: 'how_companies_win/books/The Hard Thing About Hard Things.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'Play Bigger', author: 'Al Ramadan, Dave Peterson, Christopher Lochhead, Kevin Maney',
    filePath: 'how_companies_win/books/Play Bigger.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'The Cold Start Problem', author: 'Andrew Chen',
    filePath: 'how_companies_win/books/The Cold Start Problem.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'book',
    title: 'Blitzscaling', author: 'Reid Hoffman',
    filePath: 'how_companies_win/books/Blitzscaling.pdf',
  },

  // HOW COMPANIES WIN — Biographies
  {
    pillar: 'how_companies_win', content_type: 'biography',
    title: 'Steve Jobs', author: 'Walter Isaacson',
    filePath: 'how_companies_win/biographies/Steve Jobs.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'biography',
    title: 'Elon Musk', author: 'Walter Isaacson',
    filePath: 'how_companies_win/biographies/Elon Musk.pdf',
  },

  // HOW COMPANIES WIN — Articles
  {
    pillar: 'how_companies_win', content_type: 'article',
    title: 'Aggregation Theory', author: 'Ben Thompson',
    url: 'https://stratechery.com/2015/aggregation-theory/',
  },
  {
    pillar: 'how_companies_win', content_type: 'article',
    title: 'The Pmarca Guide to Startups Part 1', author: 'Marc Andreessen',
    url: 'https://pmarchive.com/guide_to_startups_part1.html',
  },
  {
    pillar: 'how_companies_win', content_type: 'article',
    title: 'The Pmarca Guide to Startups Part 2', author: 'Marc Andreessen',
    url: 'https://pmarchive.com/guide_to_startups_part2.html',
  },
  // SKIPPED — already in DB: "Do Things That Don't Scale"

  // HOW COMPANIES WIN — Podcasts
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'Acquired — Apple Episode', author: 'Ben Gilbert & David Rosenthal',
    youtubeUrl: 'https://www.youtube.com/watch?v=zGEOQ6I2Sv4',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'Acquired — Nvidia Episode', author: 'Ben Gilbert & David Rosenthal',
    youtubeUrl: 'https://www.youtube.com/watch?v=nFB-AILkamw',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'Acquired — Standard Oil(1) Episode', author: 'Ben Gilbert & David Rosenthal',
    youtubeUrl: 'https://www.youtube.com/watch?v=h_jVQZgiP1A',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'Acquired — Standard Oil(2) Episode', author: 'Ben Gilbert & David Rosenthal',
    youtubeUrl: 'https://www.youtube.com/watch?v=tPNBVGPWSfc',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'Masters of Scale — Reid Hoffman on Distribution', author: 'Reid Hoffman',
    youtubeUrl: 'https://www.youtube.com/watch?v=ysz1xLMd37Y',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: "Lenny's Podcast — Brian Balfour on Growth", author: 'Lenny Rachitsky',
    youtubeUrl: 'https://www.youtube.com/watch?v=ZG3iNH4vvMA',
  },
  {
    pillar: 'how_companies_win', content_type: 'podcast',
    title: 'How I Built This — Airbnb Brian Chesky', author: 'Guy Raz',
    youtubeUrl: 'https://www.youtube.com/watch?v=W608u6sBFpo',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Platform Competition in Two-Sided Markets',
    author: 'Rochet & Tirole',
    url: 'https://www.tse-fr.eu/sites/default/files/medias/doc/wp/2002/platform.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'The Fall of the Labor Share and the Rise of Superstar Firms',
    author: 'Autor, Dorn, Katz, Patterson & Van Reenen',
    url: 'https://www.nber.org/system/files/working_papers/w23396/w23396.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Assessing the Strength of Network Effects in Social Network Platforms',
    author: 'Harvard Business School',
    url: 'https://www.hbs.edu/ris/Publication%20Files/21-086_a5189999-6335-4890-b050-a59a4b665198.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Why Do Startups Fail? A Core Competency Deficit Model',
    author: 'Szathmári et al.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10881814/',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Measuring Corporate Culture Using Machine Learning',
    author: 'Li, Mai, Shen & Yan',
    url: 'https://www.fengmai.net/download/manuscripts/LiMaiShenYan2021_Measuring%20Corporate%20Culture%20Using%20Machine%20Learning-RFS.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Generative AI at Work',
    author: 'Brynjolfsson, Li & Raymond',
    url: 'https://www.nber.org/system/files/working_papers/w31161/w31161.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'The Complexity of Corporate Culture as a Potential Source of Competitive Advantage',
    author: 'Various',
    url: 'https://arxiv.org/pdf/2305.14029',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Private Equity and Industry Performance',
    author: 'Bernstein & Lerner',
    url: 'https://www.nber.org/system/files/working_papers/w26371/w26371.pdf',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'GPTs Are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models',
    author: 'Eloundou, Manning, Mishkin & Rock',
    url: 'https://arxiv.org/pdf/2303.10130',
  },
  {
    pillar: 'how_companies_win', content_type: 'academic_paper',
    title: 'Winners and Losers in the Platform Revolution',
    author: 'Parker & Van Alstyne',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12890110/',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WHAT'S COMING — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Technological Revolutions and Financial Capital', author: 'Carlota Perez',
    filePath: 'whats_coming/books/Technological Revolutions and Financial Capital.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Sovereign Individual', author: 'James Dale Davidson and William Rees-Mogg',
    filePath: 'whats_coming/books/The Sovereign Individual.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Hot Commodities', author: 'Jim Rogers',
    filePath: 'whats_coming/books/Hot Commodities.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The World for Sale', author: 'Javier Blas and Jack Farchy',
    filePath: 'whats_coming/books/The World for Sale.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Fourth Turning', author: 'William Strauss and Neil Howe',
    filePath: 'whats_coming/books/The Fourth Turning.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Second Machine Age', author: 'Erik Brynjolfsson and Andrew McAfee',
    filePath: 'whats_coming/books/The Second Machine Age.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Power and Progress', author: 'Daron Acemoglu and Simon Johnson',
    filePath: 'whats_coming/books/Power and Progress.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The New Map', author: 'Daniel Yergin',
    filePath: 'whats_coming/books/The New Map.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Inevitable', author: 'Kevin Kelly',
    filePath: 'whats_coming/books/The Inevitable.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Superintelligence', author: 'Nick Bostrom',
    filePath: 'whats_coming/books/Superintelligence.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Life 3.0', author: 'Max Tegmark',
    filePath: 'whats_coming/books/Life 3.0.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The End of the World Is Just the Beginning', author: 'Peter Zeihan',
    filePath: 'whats_coming/books/The End of the World Is Just the Beginning.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Prisoners of Geography', author: 'Tim Marshall',
    filePath: 'whats_coming/books/Prisoners of Geography.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Factfulness', author: 'Hans Rosling',
    filePath: 'whats_coming/books/Factfulness.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Code Breaker', author: 'Walter Isaacson',
    filePath: 'whats_coming/books/The Code Breaker.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Lifespan', author: 'David Sinclair',
    filePath: 'whats_coming/books/Lifespan.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'The Dollar Trap', author: 'Eswar Prasad',
    filePath: 'whats_coming/books/The Dollar Trap.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'Currency Wars', author: 'James Rickards',
    filePath: 'whats_coming/books/Currency Wars.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'book',
    title: 'How the World Really Works', author: 'Vaclav Smil',
    filePath: 'whats_coming/books/How the World Really Works.pdf',
  },

  // WHAT'S COMING — Articles
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Situational Awareness', author: 'Leopold Aschenbrenner',
    url: 'https://situational-awareness.ai/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'The Changing World Order', author: 'Ray Dalio',
    url: 'https://www.economicprinciples.org/DalioChangingWorldOrderCharts.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Is War Between China and the US Inevitable?', author: 'Graham Allison',
    url: 'https://www.belfercenter.org/research-analysis/managing-dangers-irans-remaining-nuclear-capabilities',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'The Fraying of the US Global Currency Reserve System', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/fraying-petrodollar-system/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'A Century of Fiscal and Monetary Policy', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/fiscal-and-monetary-policy/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Why Trade Deficits Matter', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/trade-deficit/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'How to Win a Currency War', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/currency-war/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'The Hidden Costs of Reshoring', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/reshoring/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Energy: The Area Under the Curve', author: 'Lyn Alden',
    url: 'https://www.lynalden.com/the-area-under-the-curve/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'World Population Prospects 2024 Summary', author: 'United Nations',
    url: 'https://population.un.org/wpp/publications/',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Energy Transitions: How Long Do They Really Take?', author: 'Vaclav Smil',
    url: 'https://vaclavsmil.com/wp-content/uploads/2014/01/smil-article-2014-energy-transitions-history-requirements-prospects.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'Halfway Between Kyoto and 2050: Zero Carbon Is a Highly Unlikely Outcome', author: 'Vaclav Smil',
    url: 'https://www.fraserinstitute.org/sites/default/files/halfway-between-kyoto-and-2050.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'article',
    title: 'The Hyperloop: A 200-Year History of Hype and Failure', author: 'Vaclav Smil',
    url: 'https://thereader.mitpress.mit.edu/the-hyperloop-a-200-year-history-of-hype-and-failure/',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Technological Revolutions and Techno-Economic Paradigms', author: 'Carlota Perez',
    url: 'https://carlotaperez.org/wp-content/downloads/publications/organizational-change/TRs_TEP_shifts_and_SIF_ch.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Geoeconomic Fragmentation and the Future of Multilateralism',
    author: 'Aiyar, Ilyina et al. (IMF)',
    url: 'https://www.imf.org/-/media/files/publications/sdn/2023/english/sdnea2023001.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Institutions, Technology and Prosperity',
    author: 'Daron Acemoglu',
    url: 'https://www.nber.org/system/files/working_papers/w33442/w33442.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Changing Global Linkages: A New Cold War?',
    author: 'IMF Working Paper 2024',
    url: 'https://www.imf.org/-/media/files/publications/wp/2024/english/wpiea2024076-print-pdf.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'The Rapid Adoption of Generative AI',
    author: 'Bick, Blandin & Deming',
    url: 'https://www.nber.org/system/files/working_papers/w32966/w32966.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'GPTs Are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models',
    author: 'Eloundou, Manning, Mishkin & Rock',
    url: 'https://arxiv.org/pdf/2303.10130',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Measuring Geopolitical Risk',
    author: 'Caldara & Iacoviello',
    url: 'https://www.matteoiacoviello.com/gpr_files/GPR_PAPER.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Halfway Between Kyoto and 2050: Zero Carbon Is a Highly Unlikely Outcome',
    author: 'Vaclav Smil',
    url: 'https://www.fraserinstitute.org/sites/default/files/halfway-between-kyoto-and-2050.pdf',
  },
  {
    pillar: 'whats_coming', content_type: 'academic_paper',
    title: 'Shifting Work Patterns with Generative AI',
    author: 'Brynjolfsson et al.',
    url: 'https://www.nber.org/system/files/working_papers/w33795/w33795.pdf',
  },

  // WHAT'S COMING — Podcasts
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Lex Fridman — Sam Altman', author: 'Lex Fridman',
    youtubeUrl: 'https://www.youtube.com/watch?v=jvqFAi7vkBc',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Lex Fridman — Andrej Karpathy', author: 'Lex Fridman',
    youtubeUrl: 'https://www.youtube.com/watch?v=cdiD-9MMpb0',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Dwarkesh Podcast — Dario Amodei', author: 'Dwarkesh Patel',
    youtubeUrl: 'https://www.youtube.com/watch?v=ugvHCXCOmm4',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Dwarkesh Podcast — Ilya Sutskever', author: 'Dwarkesh Patel',
    youtubeUrl: 'https://www.youtube.com/watch?v=13CZPWmke6A',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Peter Zeihan — Collapse of Globalization', author: 'Peter Zeihan',
    youtubeUrl: 'https://www.youtube.com/watch?v=wRT7P-VKM0k',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Peter Zeihan — Mapping the Collapse of Globalization', author: 'Technovation Podcast',
    youtubeUrl: 'https://www.youtube.com/watch?v=gMJyhsZ7Ryw',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Niall Ferguson — History of Money, Power, War and Truth', author: 'Lex Fridman',
    youtubeUrl: 'https://www.youtube.com/watch?v=xF6x1ftN-H4',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Lyn Alden — The Collapse Has Already Started', author: 'Lyn Alden',
    youtubeUrl: 'https://www.youtube.com/watch?v=NUaNrRBvKHQ',
  },
  {
    pillar: 'whats_coming', content_type: 'podcast',
    title: 'Lyn Alden — Macro Investment Portfolio', author: 'MacroVoices',
    youtubeUrl: 'https://www.youtube.com/watch?v=iYcz9I7Zwwc',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THINK SHARPER — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'The Great Mental Models Volume 1', author: 'Shane Parrish',
    filePath: 'think_sharper/books/The Great Mental Models Volume 1.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'The Great Mental Models Volume 2', author: 'Shane Parrish',
    filePath: 'think_sharper/books/The Great Mental Models Volume 2.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Thinking in Bets', author: 'Annie Duke',
    filePath: 'think_sharper/books/Thinking in Bets.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Superforecasting', author: 'Philip Tetlock',
    filePath: 'think_sharper/books/Superforecasting.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'The Signal and the Noise', author: 'Nate Silver',
    filePath: 'think_sharper/books/The Signal and the Noise.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Seeking Wisdom', author: 'Peter Bevelin',
    filePath: 'think_sharper/books/Seeking Wisdom.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Fooled by Randomness', author: 'Nassim Taleb',
    filePath: 'think_sharper/books/Fooled by Randomness.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'The Black Swan', author: 'Nassim Taleb',
    filePath: 'think_sharper/books/The Black Swan.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Antifragile', author: 'Nassim Taleb',
    filePath: 'think_sharper/books/Antifragile.pdf',
  },
  {
    pillar: 'think_sharper', content_type: 'book',
    title: 'Being Wrong', author: 'Kathryn Schulz',
    filePath: 'think_sharper/books/Being Wrong.pdf',
  },

  // THINK SHARPER — Articles
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Inversion: The Power of Avoiding Stupidity', author: 'fs.blog',
    url: 'https://fs.blog/inversion/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'The Work Required to Have an Opinion', author: 'fs.blog',
    url: 'https://fs.blog/the-work-required-to-have-an-opinion/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'First Principles Thinking', author: 'fs.blog',
    url: 'https://fs.blog/first-principles/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Mental Models: How to Train Your Brain', author: 'fs.blog',
    url: 'https://fs.blog/mental-models/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'How to Think for Yourself', author: 'Paul Graham',
    url: 'https://paulgraham.com/think.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Putting Ideas into Words', author: 'Paul Graham',
    url: 'https://paulgraham.com/words.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Keep Your Identity Small', author: 'Paul Graham',
    url: 'https://paulgraham.com/identity.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'What You Cannot Say', author: 'Paul Graham',
    url: 'https://paulgraham.com/say.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'The Top Idea in Your Mind', author: 'Paul Graham',
    url: 'https://paulgraham.com/top.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'How to Disagree', author: 'Paul Graham',
    url: 'https://paulgraham.com/disagree.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Solitude and Leadership', author: 'William Deresiewicz',
    url: 'https://theamericanscholar.org/solitude-and-leadership/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'You and Your Research', author: 'Richard Hamming',
    url: 'https://www.cs.virginia.edu/~robins/YouAndYourResearch.html',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'The Strength of Weak Ties', author: 'fs.blog',
    url: 'https://fs.blog/the-strength-of-weak-ties/',
  },
  {
    pillar: 'think_sharper', content_type: 'article',
    title: 'Bayesian Thinking', author: 'fs.blog',
    url: 'https://fs.blog/bayes-theorem/',
  },

  // THINK SHARPER — Podcasts
  {
    pillar: 'think_sharper', content_type: 'podcast',
    title: 'The Knowledge Project — Naval Ravikant', author: 'Shane Parrish',
    youtubeUrl: 'https://www.youtube.com/watch?v=HiYo14wylQw',
  },
  {
    pillar: 'think_sharper', content_type: 'podcast',
    title: 'The Knowledge Project — Annie Duke', author: 'Shane Parrish',
    youtubeUrl: 'https://www.youtube.com/watch?v=uYNsSeYjkp4&t=10s',
  },
  {
    pillar: 'think_sharper', content_type: 'podcast',
    title: 'Lex Fridman — Daniel Kahneman', author: 'Lex Fridman',
    youtubeUrl: 'https://www.youtube.com/watch?v=UwwBG-MbniY',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MOVE PEOPLE — Books
  // ══════════════════════════════════════════════════════════════════════════
  {
    pillar: 'move_people', content_type: 'book',
    title: 'The Art Of Seduction', author: 'Robert Greene',
    filePath: 'move_people/books/The Art Of Seduction.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'The Laws Of Human Nature', author: 'Robert Greene',
    filePath: 'move_people/books/The Laws Of Human Nature.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'The 48 Laws Of Power', author: 'Robert Greene',
    filePath: 'move_people/books/The 48 Laws Of Power.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Pre-Suasion', author: 'Robert Cialdini',
    filePath: 'move_people/books/Pre-Suasion.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Made to Stick', author: 'Chip Heath and Dan Heath',
    filePath: 'move_people/books/Made to Stick.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Never Split the Difference', author: 'Chris Voss',
    filePath: 'move_people/books/Never Split the Difference.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Pitch Anything', author: 'Oren Klaff',
    filePath: 'move_people/books/Pitch Anything.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'The Storytelling Animal', author: 'Jonathan Gottschall',
    filePath: 'move_people/books/The Storytelling Animal.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Talk Like TED', author: 'Carmine Gallo',
    filePath: 'move_people/books/Talk Like TED.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'On Writing Well', author: 'William Zinsser',
    filePath: 'move_people/books/On Writing Well.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'Simply Said', author: 'Jay Sullivan',
    filePath: 'move_people/books/Simply Said.pdf',
  },
  {
    pillar: 'move_people', content_type: 'book',
    title: 'To Sell Is Human', author: 'Daniel Pink',
    filePath: 'move_people/books/To Sell Is Human.pdf',
  },

  // MOVE PEOPLE — Articles
  {
    pillar: 'move_people', content_type: 'article',
    title: 'Write Like You Talk', author: 'Paul Graham',
    url: 'https://paulgraham.com/talk.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'Write Simply', author: 'Paul Graham',
    url: 'https://paulgraham.com/simply.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'Writing and Speaking', author: 'Paul Graham',
    url: 'https://paulgraham.com/speak.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'The Age of the Essay', author: 'Paul Graham',
    url: 'https://paulgraham.com/essay.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'How to Write Usefully', author: 'Paul Graham',
    url: 'https://paulgraham.com/useful.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'David Ogilvy\'s 1982 Memo: How to Write', author: 'David Ogilvy',
    url: 'https://fs.blog/david-ogilvy-10-tips-on-writing/',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'The Secret Structure of Great Talks', author: 'Nancy Duarte',
    url: 'https://www.ted.com/talks/nancy_duarte_the_secret_structure_of_great_talks',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'Solitude and Leadership', author: 'William Deresiewicz',
    url: 'https://theamericanscholar.org/solitude-and-leadership/',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'The Maker\'s Schedule, Manager\'s Schedule', author: 'Paul Graham',
    url: 'https://paulgraham.com/makerschedule.html',
  },
  {
    pillar: 'move_people', content_type: 'article',
    title: 'Persuade xor Discover', author: 'Paul Graham',
    url: 'https://paulgraham.com/discover.html',
  },


  // MOVE PEOPLE — Podcasts
  {
    pillar: 'move_people', content_type: 'podcast',
    title: 'Masters of Scale — Storytelling with Reid Hoffman', author: 'Reid Hoffman',
    youtubeUrl: 'https://www.youtube.com/watch?v=PB64IQrkID8',
  },
  // SKIPPED — already in DB: "How I Built This — Sara Blakely Spanx"
  {
    pillar: 'move_people', content_type: 'podcast',
    title: 'The Tim Ferriss Show — Matthew McConaughey on Narrative Identity', author: 'Tim Ferriss',
    youtubeUrl: 'https://www.youtube.com/watch?v=H_3Bfj99xYU',
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

function buildSourceKey(source) {
  const slug = `${source.pillar}-${source.content_type}-${source.title || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

function sourceUrlForRecord(source) {
  if (source.url) return source.url
  if (source.youtubeUrl) return source.youtubeUrl
  if (source.arxivId) return `https://arxiv.org/abs/${extractArxivId(source.arxivId)}`
  return null
}

function clampConfidence(value, fallback = 0.5) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function cleanString(value, fallback = '') {
  const text = sanitizeText(String(value || '')).replace(/\s+/g, ' ').trim()
  return text || fallback
}

function cleanStringArray(values, limit = 8) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((item) => cleanString(item)).filter(Boolean))].slice(0, limit)
}

function cleanImplications(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    builders: cleanStringArray(input.builders, 6),
    capital: cleanStringArray(input.capital, 6),
    operators: cleanStringArray(input.operators, 6),
    policy: cleanStringArray(input.policy, 6),
  }
}

function parseJsonContent(content) {
  const raw = String(content || '').trim()
  const withoutFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  return JSON.parse(withoutFence)
}

function buildEnrichmentExcerpt(rawText) {
  const cleaned = sanitizeText(rawText).replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 18000) return cleaned

  const segment = 6000
  const middleStart = Math.max(0, Math.floor(cleaned.length / 2) - Math.floor(segment / 2))
  const endStart = Math.max(0, cleaned.length - segment)

  return [
    cleaned.slice(0, segment),
    cleaned.slice(middleStart, middleStart + segment),
    cleaned.slice(endStart),
  ].join('\n\n[...]\n\n')
}

function normalizeSourceClaims(payload) {
  const input = payload && typeof payload === 'object' ? payload : {}
  return {
    core_thesis: cleanString(input.core_thesis),
    main_themes: cleanStringArray(input.main_themes, 6),
    keywords: cleanStringArray(input.keywords, 12),
    domains: cleanStringArray(input.domains, 8),
    representative_claims: cleanStringArray(input.representative_claims, 6),
  }
}

function normalizeAxiomInterpretation(payload) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const timeHorizon = cleanString(input.time_horizon)
  return {
    signal_types: cleanStringArray(input.signal_types, 6).filter((item) => SIGNAL_TYPES.has(item)),
    time_horizon: TIME_HORIZONS.has(timeHorizon) ? timeHorizon : null,
    practical_implications: cleanImplications(input.practical_implications),
    counterarguments: cleanStringArray(input.counterarguments, 6),
    uncertainty_notes: cleanStringArray(input.uncertainty_notes, 6),
  }
}

async function extractSourceClaims(rawText, source) {
  const excerpt = buildEnrichmentExcerpt(rawText)
  const response = await openai.chat.completions.create({
    model: SOURCE_ENRICHMENT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 700,
    messages: [
      {
        role: 'system',
        content: `You extract grounded claims from a source for Axiom's canonical knowledge layer.

Return valid JSON only with this exact shape:
{
  "core_thesis": "string",
  "main_themes": ["string"],
  "keywords": ["string"],
  "domains": ["string"],
  "representative_claims": ["string"],
  "confidence": 0.0
}

Rules:
- Use only what is clearly supported by the source text.
- Do not infer strategic implications.
- Keep core_thesis to one sharp sentence.
- main_themes should be 2 to 6 items.
- representative_claims should be concrete claims the source itself makes.
- confidence must be between 0 and 1.`,
      },
      {
        role: 'user',
        content: `Title: ${source.title}
Author: ${source.author || 'Unknown'}
Pillar: ${source.pillar}
Content type: ${source.content_type}

Source excerpt:
${excerpt}`,
      },
    ],
  })

  const parsed = parseJsonContent(response.choices[0]?.message?.content)
  return {
    claims: normalizeSourceClaims(parsed),
    confidence: clampConfidence(parsed.confidence, 0.55),
  }
}

async function interpretSourceForAxiom(rawText, source, sourceClaims) {
  const excerpt = buildEnrichmentExcerpt(rawText)
  const response = await openai.chat.completions.create({
    model: SOURCE_ENRICHMENT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 700,
    messages: [
      {
        role: 'system',
        content: `You interpret a source through Axiom's lens without pretending the source literally said these implications.

Return valid JSON only with this exact shape:
{
  "signal_types": ["capability_shift|distribution_shift|capital_flow|behavior_change|policy_shift|infrastructure_bottleneck|market_structure"],
  "time_horizon": "immediate|near_term|medium_term|long_term|timeless",
  "practical_implications": {
    "builders": ["string"],
    "capital": ["string"],
    "operators": ["string"],
    "policy": ["string"]
  },
  "counterarguments": ["string"],
  "uncertainty_notes": ["string"],
  "confidence": 0.0
}

Rules:
- This is Axiom's interpretation, not a quote from the source.
- Be specific, not generic.
- Include only implications that plausibly follow from the source claims.
- confidence must be between 0 and 1.`,
      },
      {
        role: 'user',
        content: `Title: ${source.title}
Author: ${source.author || 'Unknown'}
Pillar: ${source.pillar}
Content type: ${source.content_type}

Grounded source claims:
${JSON.stringify(sourceClaims, null, 2)}

Source excerpt:
${excerpt}`,
      },
    ],
  })

  const parsed = parseJsonContent(response.choices[0]?.message?.content)
  return {
    interpretation: normalizeAxiomInterpretation(parsed),
    confidence: clampConfidence(parsed.confidence, 0.5),
  }
}

async function upsertWikiSource(source, rawText) {
  const payload = {
    pillar: source.pillar,
    content_type: source.content_type,
    title: source.title,
    author: source.author || null,
    source_url: sourceUrlForRecord(source),
    source_key: buildSourceKey(source),
    summary_for_retrieval: sanitizeText(rawText).slice(0, 1200) || null,
    enrichment_status: 'raw',
    enrichment_version: SOURCE_ENRICHMENT_VERSION,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('wiki_sources')
    .upsert(payload, { onConflict: 'source_key' })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Could not upsert wiki_sources row for "${source.title}": ${error.message}`)
  }

  try {
    const { claims, confidence: claimsConfidence } = await extractSourceClaims(rawText, source)
    const { error: claimsError } = await supabase
      .from('wiki_sources')
      .update({
        source_claims: claims,
        source_claims_confidence: claimsConfidence,
        enrichment_status: 'claims_extracted',
        enrichment_version: SOURCE_ENRICHMENT_VERSION,
        enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)

    if (claimsError) {
      throw new Error(claimsError.message)
    }

    try {
      const { interpretation, confidence: interpretationConfidence } = await interpretSourceForAxiom(rawText, source, claims)
      const { error: interpretationError } = await supabase
        .from('wiki_sources')
        .update({
          axiom_interpretation: interpretation,
          axiom_interpretation_confidence: interpretationConfidence,
          enrichment_status: 'interpreted',
          enrichment_version: SOURCE_ENRICHMENT_VERSION,
          enriched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id)

      if (interpretationError) {
        throw new Error(interpretationError.message)
      }
    } catch (err) {
      console.warn(`    Source interpretation failed for "${source.title}": ${err.message}`)
      const { error: failError } = await supabase
        .from('wiki_sources')
        .update({
          enrichment_status: 'failed',
          enrichment_version: SOURCE_ENRICHMENT_VERSION,
          enriched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id)

      if (failError) {
        console.warn(`    Could not mark wiki_sources failure for "${source.title}": ${failError.message}`)
      }
    }
  } catch (err) {
    console.warn(`    Source claims extraction failed for "${source.title}": ${err.message}`)
    const { error: failError } = await supabase
      .from('wiki_sources')
      .update({
        enrichment_status: 'failed',
        enrichment_version: SOURCE_ENRICHMENT_VERSION,
        enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)

    if (failError) {
      console.warn(`    Could not mark wiki_sources failure for "${source.title}": ${failError.message}`)
    }
  }

  return data
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

function buildJinaReaderUrl(url) {
  return `${JINA_READER_BASE_URL}${url.replace(/^https?:\/\//i, '')}`
}

async function fetchJinaReadableText(url) {
  const jinaUrl = buildJinaReaderUrl(url)
  const response = await axios.get(jinaUrl, {
    responseType: 'text',
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',
      'X-Return-Format': 'markdown',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    maxRedirects: 5,
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Jina Reader HTTP ${response.status}`)
  }

  const text = sanitizeText(String(response.data || ''))
  if (text.length < 400) {
    throw new Error('Jina Reader returned too little text')
  }

  return text
}

async function fetchRemoteBinary(url) {
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

  return response
}

async function processHtmlWithCheerio(url, response) {
  const contentType = (response.headers['content-type'] || '').toLowerCase()
  const isPDF =
    contentType.includes('application/pdf') ||
    contentType.includes('application/octet-stream') ||
    url.toLowerCase().endsWith('.pdf')

  if (isPDF) {
    const data = await pdfParse(Buffer.from(response.data))
    return data.text
  }

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

function extractArxivId(value) {
  const input = String(value || '').trim()
  if (!input) return null

  try {
    const parsed = new URL(input)
    const match = parsed.pathname.match(/\/(?:abs|pdf)\/([^/]+?)(?:\.pdf)?$/i)
    return match?.[1] || null
  } catch {
    return input.replace(/^arxiv:/i, '').replace(/\.pdf$/i, '').trim() || null
  }
}

function parseArxivMetadata(xml) {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i)
  if (!entryMatch) return null
  const entry = entryMatch[1]
  const readTag = (tag) => {
    const match = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
    return match ? sanitizeText(match[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, '')) : ''
  }
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/gi)]
    .map((match) => sanitizeText(match[1]))
    .filter(Boolean)
  const pdfLinkMatch = entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/i)
  const id = sanitizeText(readTag('id')).replace(/^https?:\/\/arxiv\.org\/abs\//i, '')

  return {
    id,
    title: readTag('title'),
    summary: readTag('summary'),
    published: readTag('published'),
    updated: readTag('updated'),
    authors,
    pdfUrl: pdfLinkMatch?.[1] || (id ? `https://arxiv.org/pdf/${id}.pdf` : null),
  }
}

async function processArxivPaper(source) {
  const rawId = source.arxivId || source.url
  const arxivId = extractArxivId(rawId)
  if (!arxivId) {
    throw new Error(`Could not extract arXiv ID from: ${rawId}`)
  }

  const metadataResponse = await axios.get(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
    {
      responseType: 'text',
      timeout: 30000,
      validateStatus: () => true,
    }
  )

  if (metadataResponse.status < 200 || metadataResponse.status >= 300) {
    throw new Error(`arXiv metadata HTTP ${metadataResponse.status} for ${arxivId}`)
  }

  const metadata = parseArxivMetadata(String(metadataResponse.data || ''))
  if (!metadata) {
    throw new Error(`Could not parse arXiv metadata for ${arxivId}`)
  }

  const pdfUrl = metadata.pdfUrl
  if (pdfUrl) {
    try {
      const pdfResponse = await fetchRemoteBinary(pdfUrl)
      const pdfText = await processHtmlWithCheerio(pdfUrl, pdfResponse)
      if (sanitizeText(pdfText).length >= 1200) {
        return pdfText
      }
    } catch (err) {
      console.warn(`    arXiv PDF fallback triggered for "${source.title}": ${err.message}`)
    }
  }

  const abstractText = [
    metadata.title ? `Title: ${metadata.title}` : null,
    metadata.authors.length ? `Authors: ${metadata.authors.join(', ')}` : null,
    metadata.published ? `Published: ${metadata.published}` : null,
    metadata.summary ? `Abstract: ${metadata.summary}` : null,
  ].filter(Boolean).join('\n\n')

  if (sanitizeText(abstractText).length < 300) {
    throw new Error(`arXiv fallback abstract too short for ${arxivId}`)
  }

  return abstractText
}

async function processURL(url) {
  const isPdfUrl = url.toLowerCase().endsWith('.pdf')
  if (!isPdfUrl) {
    try {
      return await fetchJinaReadableText(url)
    } catch (err) {
      console.warn(`    Jina Reader fallback for ${url}: ${err.message}`)
    }
  }

  const response = await fetchRemoteBinary(url)
  return processHtmlWithCheerio(url, response)
}

function extractYouTubeVideoId(youtubeUrl) {
  try {
    const url = new URL(youtubeUrl)
    const hostname = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)

    if (hostname === 'youtu.be') return parts[0]

    if (hostname === 'youtube.com' || hostname === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v')
      if (parts[0] === 'embed' || parts[0] === 'shorts') return parts[1]
    }
  } catch {
    // Fall through to the regex fallback below.
  }

  const match = youtubeUrl.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^#\s]*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  return match?.[1]
}

async function fetchYouTubeTranscript(videoId) {
  const helperPath = path.join(__dirname, 'scripts', 'fetch_youtube_transcript.py')
  const pythonBins = [process.env.PYTHON_BIN || 'python3', 'python']
  let lastErr

  for (const pythonBin of [...new Set(pythonBins)]) {
    try {
      const { stdout, stderr } = await execFileAsync(
        pythonBin,
        [helperPath, videoId],
        {
          cwd: __dirname,
          env: process.env,
          maxBuffer: 50 * 1024 * 1024,
        }
      )

      if (stderr.trim()) console.warn(stderr.trim())

      return JSON.parse(stdout)
    } catch (err) {
      lastErr = err
      if (err.code !== 'ENOENT') break
    }
  }

  const stderr = lastErr?.stderr?.trim()
  const message = stderr || lastErr?.message || 'unknown transcript fetch error'
  throw new Error(message)
}

async function processYouTube(youtubeUrl) {
  const videoId = extractYouTubeVideoId(youtubeUrl)
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`Could not extract video ID from: ${youtubeUrl}`)
  }

  try {
    const result = await fetchYouTubeTranscript(videoId)

    if (!result.text || result.char_count === 0) {
      console.log(`    YouTube ${videoId}: failed — empty response`)
      throw new Error('empty response')
    }

    console.log(
      `    YouTube ${videoId}: ${result.method} succeeded — ${result.char_count} chars extracted`
    )
    return result.text
  } catch (err) {
    console.log(`    YouTube ${videoId}: failed — ${err.message}`)
    throw new Error(`Transcript unavailable for ${youtubeUrl}: ${err.message}`)
  }
}

// ─── Embedding + Insert ───────────────────────────────────────────────────────

async function embedAndInsert(source, sourceRecord, chunks) {
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
      source_id: sourceRecord.id,
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

  if (source.needs_pdf && !source.filePath) {
    throw new Error(`Manual PDF required for "${source.title}"`)
  }

  if (source.filePath) {
    rawText = await processLocalPDF(source.filePath)
  } else if (source.transcriptPath) {
    rawText = processTranscript(source.transcriptPath)
  } else if (source.youtubeUrl) {
    rawText = await processYouTube(source.youtubeUrl)
  } else if (source.arxivId) {
    rawText = await processArxivPaper(source)
  } else if (source.url) {
    rawText = await processURL(source.url)
  } else {
    throw new Error('Source has no filePath, transcriptPath, youtubeUrl, arxivId, or url')
  }

  if (!rawText || rawText.trim().length < 500) {
    throw new Error(`Extracted text too short (${rawText?.trim().length ?? 0} chars) — likely a paywall, redirect, or empty page`)
  }

  const sourceRecord = await upsertWikiSource(source, rawText)
  const chunks = chunkText(rawText)
  if (chunks.length === 0) throw new Error('No usable chunks extracted')

  const inserted = await embedAndInsert(source, sourceRecord, chunks)
  return { chunks: chunks.length, inserted }
}

async function ensureSeedDirectories() {
  const transcriptsDir = path.join(SOURCES_DIR, 'transcripts')
  for (const dir of [SOURCES_DIR, transcriptsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`Created ${dir}\n`)
    }
  }

  return { transcriptsDir }
}

async function fetchProcessedTitles() {
  const processedTitles = new Set()
  const PAGE = 1000
  let offset = 0

  while (true) {
    const { data: page, error: fetchError } = await supabase
      .from('wiki_chunks')
      .select('title')
      .range(offset, offset + PAGE - 1)
    if (fetchError) {
      throw new Error(`Could not fetch existing titles: ${fetchError.message}`)
    }
    if (!page || page.length === 0) break
    page.forEach((record) => processedTitles.add(record.title))
    if (page.length < PAGE) break
    offset += PAGE
  }

  return processedTitles
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

  await ensureSeedDirectories()

  // Fetch all titles already in DB — used to skip re-processing on re-runs
  // Paginate through all existing titles — Supabase default cap is 1000 rows per query
  const processedTitles = await fetchProcessedTitles()
  console.log(`Found ${processedTitles.size} unique title(s) already in DB.\n`)

  // Order: pillars follow Axiom's six-pillar sequence
  // Within each pillar: book → article → podcast → financial_doc → biography → company_profile → academic_paper
  const TYPE_ORDER = ['book', 'article', 'podcast', 'financial_doc', 'case_study', 'biography', 'company_profile', 'academic_paper']
  const PILLAR_ORDER = [
    'money_game',
    'human_mind',
    'how_companies_win',
    'whats_coming',
    'think_sharper',
    'move_people',
  ]

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
    const sourceType = source.filePath
      ? 'pdf'
      : source.needs_pdf
        ? 'needs_pdf'
        : source.transcriptPath
          ? 'transcript'
          : source.youtubeUrl
            ? 'youtube'
            : 'url'
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

export {
  SOURCES_DIR,
  chunkText,
  processURL,
  processYouTube,
  processArxivPaper,
  upsertWikiSource,
  embedAndInsert,
  processSource,
  fetchProcessedTitles,
  ensureSeedDirectories,
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
