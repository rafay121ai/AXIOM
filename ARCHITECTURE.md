# Axiom — Architecture Document

## System Overview

Axiom is composed of 4 layers. Every layer has one job.

### Layer 1 — Interface (Next.js on Vercel)
Everything the user sees and touches.
- Founder Brain sphere (Three.js)
- Onboarding flow
- Session chat interface with streaming
- Bottom text bar
- Node interaction and visualization
- Real time sphere updates as nodes and edges are created
- Auth screens — signup, login, reapplication form

### Layer 2 — Intelligence (FastAPI on Railway)
Everything that thinks.
- Session management and routing
- Auth validation on every request via Supabase JWT
- Claude API calls — all 9 call types
- Onboarding answer processing — pillar mapping, weight scoring,
  seed node generation
- Pattern detection across sessions
- Node and edge creation logic
- Experiment window determination
- Ghosting detection and warning queue management
- System prompt construction and management
- Token estimation and context window management
- Rate limiting enforcement at application level
- Lemon Squeezy webhook handling (when activated)
- Resend email dispatch

### Layer 3 — Memory (Supabase)
Everything that persists.

User Data:
- User profiles and auth records (Supabase Auth)
- Onboarding answers and pillar weight scores
- Axiom's private theory of the user — contradictions,
  blind spots, behavioral gaps, pushback patterns,
  full pattern history across all sessions

Session Data:
- Full session history per user — every message, every response
- Session summaries — generated at session end
- Session pillar tags — which pillars each session touched
- Opening read history — what Axiom said at session open

Experiment Data:
- Active experiments — status, window, pillar, assigned date
- Completed experiments — outcome reported by user
- Ghosted experiments — flagged after 2 unreferenced follow ups
- Experiment negotiation history — every pushback reason logged

Founder Brain Data:
- All nodes per user — pillar, state, creation date
- Node insight text — exact Axiom-generated sentence per node
- All edges per user — which nodes connected, creation date
- Edge insight text — exact Axiom-generated sentence per edge

Knowledge Data:
- Global wiki per pillar — curated knowledge base
- Personal wiki per user — session-generated knowledge layer

Removal Data:
- Warning records — warning 1, warning 2, dates, reason
- Removal records — date, reason, refund status
- Reapplication logs — application, response, decision

Asset Storage (Supabase Storage):
- Shareable brain snapshot PNGs — generated on user request,
  stored with public URL for sharing

### Layer 4 — Delivery (Railway)
Everything that runs.
- FastAPI backend hosting
- Background jobs — 4 jobs running continuously
- Supabase connection management via PgBouncer
- Environment variable management
- Error logging

### Infrastructure Map
```
User Browser
    ↓ HTTPS
Vercel (Next.js)
    ↓ REST + Streaming (HTTPS)
Railway (FastAPI)
    ↓              ↓               ↓             ↓
Supabase DB   Supabase Auth   Claude API    Resend
(PostgreSQL)  (JWT tokens)    (Anthropic)   (Email)
    ↓
Supabase Storage
(Brain snapshots)
```

### How The Layers Connect
User opens app →
Next.js checks Supabase Auth JWT from httpOnly cookie →
If valid: Next.js calls FastAPI with JWT in Authorization header →
FastAPI validates JWT against Supabase public key →
FastAPI pulls session history + active experiments + node/edge
data + private theory from Supabase via PgBouncer →
FastAPI constructs context window, calls Claude API →
Claude returns opening read + highlighted node IDs →
Next.js renders sphere with highlights, guiding beam, floating text →
User enters session via node tap or bottom text bar →
FastAPI manages conversation turn by turn →
Each user message: FastAPI calls Claude API with full context,
streams response token by token back to Next.js →
Session ends: FastAPI runs summarization → node/edge creation
→ theory update in sequence →
FastAPI writes all new data to Supabase →
Next.js updates sphere — new nodes appear, edges form →
Background jobs run on Railway continuously to track experiments,
detect ghosting, queue warnings, enforce removal system

---

## Memory Architecture

### Philosophy
Memory is the product. Without it Axiom is a chatbot.
Every piece of data Axiom stores exists for one reason —
to make the next session more accurate than the last.

### Database: Supabase (PostgreSQL + PgBouncer)

PgBouncer enabled from day one in transaction pooling mode.
Max client connections: 100.
Pool size per database user: 20.
This prevents connection exhaustion under concurrent load.
All FastAPI database calls use the pooled connection string,
never the direct connection string.

#### users
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key, matches Supabase Auth uid |
| email | text | Auth email |
| first_name | text | Used by Axiom in sessions sparingly |
| created_at | timestamptz | Signup date |
| removed_at | timestamptz | Removal date if applicable |
| removal_reason | text | Logged reason for removal |
| reapplication_eligible_at | timestamptz | 3 months post removal |
| refund_issued | boolean | Whether refund was processed |
| refund_issued_at | timestamptz | When refund was processed |
| is_testing | boolean | Testing mode flag — all features unlocked |
| lemon_squeezy_customer_id | text | Set when payments activate |
| subscription_status | text | active/cancelled/removed/testing |
| session_count_today | int | Resets at midnight UTC |
| last_session_at | timestamptz | Last session timestamp |

#### onboarding_answers
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| question_code | text | HM1, MG2, CL3 etc |
| pillar | text | Which pillar this feeds |
| answer_index | int | Which option selected (0,1,2) |
| answer_text | text | Full answer text |
| created_at | timestamptz | When answered |

Index: user_id

#### user_theory
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users, unique |
| contradictions | jsonb | Gaps between stated goals and behavior |
| blind_spots | jsonb | Patterns user hasn't named themselves |
| behavioral_gaps | jsonb | What they say vs what they do |
| pushback_patterns | jsonb | What they resist and why |
| pillar_maturity | jsonb | Stage per pillar |
| overall_maturity | text | Novice/Developing/Sharp/Founder-grade |
| theory_version | int | Increments on every update |
| updated_at | timestamptz | Last update timestamp |

Index: user_id (unique)

#### sessions
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| created_at | timestamptz | Session start |
| ended_at | timestamptz | Session end |
| pillars_touched | text[] | Pillars this session hit |
| opening_read | text | What Axiom said at session open |
| entry_type | text | node_tap / text_bar |
| entry_node_id | uuid | Node tapped if applicable |
| message_count | int | Total messages in session |
| summary | jsonb | Generated at session end |
| summary_generated_at | timestamptz | When summary was written |

Index: user_id, created_at DESC

#### messages
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| session_id | uuid | Foreign key → sessions |
| user_id | uuid | Foreign key → users |
| role | text | user / axiom |
| content | text | Full message text |
| created_at | timestamptz | Timestamp |
| pillar_tags | text[] | Pillars detected in this message |
| token_count | int | Estimated tokens for this message |

Index: session_id, created_at ASC
Hard limit: 50 messages per session enforced at DB level
via trigger — insert rejected if count exceeds 50

#### experiments
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| session_id | uuid | Session it was assigned in |
| pillar | text | Which pillar |
| content | text | Full experiment text |
| example | text | Universal example delivered with it |
| window_hours | int | Hours to complete (24-168) |
| assigned_at | timestamptz | When assigned |
| due_at | timestamptz | Deadline — assigned_at + window_hours |
| status | text | active/completed/ghosted/reset/replaced |
| follow_up_count | int | Times Axiom has referenced it (max 2) |
| outcome | text | User's report — null if not reported |
| negotiation_log | jsonb | Full pushback history |
| completed_at | timestamptz | When marked complete |
| ghosted_at | timestamptz | When marked ghosted |

Index: user_id, status
Constraint: maximum 2 active experiments per user enforced
via trigger — insert rejected if active count is already 2

#### nodes
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| pillar | text | Which pillar |
| label | text | 2-3 word node name |
| state | text | dim / bright |
| insight_text | text | Axiom sentence shown on tap |
| sphere_x | float | X coordinate in 3D sphere |
| sphere_y | float | Y coordinate in 3D sphere |
| sphere_z | float | Z coordinate in 3D sphere |
| created_at | timestamptz | When created |
| brightened_at | timestamptz | When experiment completed |

Index: user_id, pillar

#### edges
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| node_a_id | uuid | Foreign key → nodes |
| node_b_id | uuid | Foreign key → nodes |
| pillar_a | text | Pillar of node A |
| pillar_b | text | Pillar of node B |
| insight_text | text | Axiom sentence shown on tap |
| has_unread_insight | boolean | Pulses on sphere until tapped |
| created_at | timestamptz | When created |

Index: user_id
Constraint: unique (node_a_id, node_b_id) — no duplicate edges

#### session_summaries
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| session_id | uuid | Foreign key → sessions, unique |
| user_id | uuid | Foreign key → users |
| main_topic | text | What was discussed |
| pillars_touched | text[] | Pillars hit |
| key_insight | text | Main pattern Axiom identified |
| experiment_assigned_id | uuid | Experiment id if assigned |
| user_energy | text | low / medium / high |
| created_at | timestamptz | When generated |
| archived | boolean | True if older than 6 months |

Index: user_id, created_at DESC, archived
Archival job runs weekly — summaries older than 6 months
flagged archived, excluded from active API context construction,
retained in DB for user data purposes

#### warnings
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| warning_number | int | 1 or 2 |
| triggered_by_experiment_id | uuid | Experiment that triggered it |
| message_text | text | The exact warning Axiom generated |
| queued_at | timestamptz | When background job queued it |
| delivered_at | timestamptz | When shown to user |
| email_sent_at | timestamptz | When backup email was sent |

Index: user_id

#### reapplications
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| applied_at | timestamptz | Application date |
| question_shown | text | The specific question shown |
| logged_reason | text | Removal reason referenced |
| user_response | text | What the user wrote |
| decision | text | accepted / declined |
| decided_at | timestamptz | When Axiom decided |
| decision_reasoning | text | Internal log — not shown to user |

Index: user_id

#### global_wiki
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| pillar | text | Which pillar |
| title | text | Source or concept title |
| type | text | book/paper/mental_model/framework |
| content | text | Curated summary |
| relevance_score | float | 0.0-1.0, scored before entry |
| duplicate_checked | boolean | Deduplication confirmed |
| added_at | timestamptz | When added |
| added_by | text | team / system |

Index: pillar, relevance_score DESC

#### personal_wiki
| Field | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → users |
| pillar | text | Which pillar |
| concept | text | Concept or insight title |
| content | text | Axiom-generated explanation for this user |
| source_session_id | uuid | Session that generated it |
| source_node_id | uuid | Node it belongs to if applicable |
| created_at | timestamptz | When created |

Index: user_id, pillar

### Row Level Security (RLS)
RLS enabled on all tables.
Users can only read and write their own rows.
Service role key (FastAPI only) bypasses RLS for
background jobs and admin operations.
No direct database access from the frontend — all
reads and writes go through FastAPI.

### How The Private Theory Updates
After every session FastAPI calls Claude with:
- Full session transcript
- Current user_theory record
- Last 5 session summaries (non-archived)
- Active experiment statuses and outcomes

Claude returns an updated theory object as JSON.
FastAPI validates the JSON against user_theory schema.
If valid: writes to user_theory, increments theory_version.
If invalid: retries once with explicit schema instruction.
The theory never resets — it only deepens.
theory_version provides an audit trail of every update.

### How The Global Wiki Gets Built
Content enters through two paths:

1. Manual curation by Axiom team per pillar
2. System flagging — when a concept appears across 50+
   user sessions it gets flagged for team review

Before any content enters:
- Relevance scored against pillar's knowledge domain (0.0-1.0)
- Entries below 0.7 relevance score rejected
- Duplicate check against existing titles and content
- Quality review by team before final entry
- duplicate_checked flag set to true on approval

### How The Personal Wiki Gets Built
Every session end, node/edge creation call also identifies
new personal wiki concepts to write. These are concepts
Axiom explained or referenced specifically for this user.
Written to personal_wiki automatically.
Personal wiki surfaces contextually mid-conversation —
FastAPI pulls relevant personal wiki entries based on
current session topic and includes them in session
response context. Never shown as a browsable library.

## Wiki Pipeline Architecture

### Overview
The wiki is Axiom's knowledge layer. It holds the actual
primary source material — full book PDFs, articles,
substack posts, tweet threads, white papers, earnings
calls, shareholder letters, court filings, podcast
transcripts, academic papers, financial audits,
regulatory filings, post-mortems, and biographies.

Not summaries. The real thing.

When Axiom responds in a session, it retrieves the most
semantically relevant chunks from this library and uses
them to ground its responses in real source material.
The user never sees the wiki directly. They experience
it as Axiom being deeply knowledgeable.

### Storage Architecture

Raw files live in Cloudflare R2.
Processed chunks and embeddings live in Supabase pgvector.
Metadata lives in Supabase global_wiki and wiki_documents.
Admin uploads file or URL to Axiom admin panel
↓
File → Cloudflare R2 (raw storage, free up to 10GB)
URL → FastAPI fetches and stores in R2
↓
R2 upload triggers Cloudflare Worker
↓
Worker calls FastAPI /wiki/process endpoint
↓
FastAPI processes document (extract → chunk → embed)
↓
Chunks + embeddings → Supabase pgvector (wiki_chunks)
Metadata → Supabase (wiki_documents)
↓
Document live and searchable

### Cloudflare R2 Setup
Bucket name: axiom-wiki
Region: auto (Cloudflare global network)
Free tier: 10GB storage, 10M requests/month — free
Cost beyond free: $0.015/GB storage, $0.36/M requests

File organization in R2:
axiom-wiki/
money-game/
books/
articles/
white-papers/
earnings-calls/
shareholder-letters/
court-filings/
podcast-transcripts/
academic-papers/
post-mortems/
regulatory-filings/
tweet-threads/
human-mind/
...
how-companies-win/
...
whats-coming/
...
think-sharper/
...
move-people/
...

### Cloudflare Worker
Triggers automatically on every R2 upload.
Calls FastAPI processing endpoint with file metadata.
~20 lines of JavaScript. Zero additional cost.

```javascript
// Cloudflare Worker — R2 trigger
export default {
  async fetch(request, env) {
    // Fired by R2 event notification on upload
    const body = await request.json()
    const { key, size, pillar, type } = body

    // Call FastAPI processing endpoint
    const response = await fetch(
      `${env.FASTAPI_URL}/wiki/process`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.WORKER_SECRET}`
        },
        body: JSON.stringify({ r2_key: key, size, pillar, type })
      }
    )
    return new Response('OK', { status: 200 })
  }
}
```

### Supported Input Types
The admin panel accepts:

Files (any size):
- PDF (.pdf) — books, white papers, reports, audits
- Word documents (.docx)
- Plain text (.txt)
- EPUB (.epub) — ebooks
- HTML (.html) — saved articles
- Markdown (.md)

URLs (FastAPI fetches and stores in R2):
- Article URLs — any publication
- Substack post URLs
- Tweet thread URLs (via Twitter/X API or nitter)
- YouTube transcript URLs
- Any public URL with readable content

No file size limit enforced by the app.
R2 handles files up to 5TB per object.
Large files (500MB+) use R2 multipart upload.

### Document Processing Pipeline
FastAPI /wiki/process endpoint.
Runs asynchronously — does not block the upload response.
Progress tracked in wiki_documents.processed field.

#### Step 1 — Text Extraction
Different extractors per file type:

```python
# PDF extraction
import fitz  # PyMuPDF
doc = fitz.open(file_path)
text = ""
for page in doc:
    text += page.get_text()

# DOCX extraction
from docx import Document
doc = Document(file_path)
text = "\n".join([p.text for p in doc.paragraphs])

# EPUB extraction
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
book = epub.read_epub(file_path)
# extract HTML content from each chapter

# URL extraction
import trafilatura
downloaded = trafilatura.fetch_url(url)
text = trafilatura.extract(downloaded)
# trafilatura handles articles, substack,
# paywalled content where possible

# Tweet thread extraction
# Twitter/X API v2 — fetch thread by URL
# Concatenate tweets in order
# Store as single document
```

#### Step 2 — Text Cleaning
```python
# Remove headers, footers, page numbers
# Remove excessive whitespace
# Remove non-UTF8 characters
# Normalize quotes and dashes
# Detect and tag language (English only for v1)
```

#### Step 3 — Chunking
```python
# 500 token chunks, 50 token overlap
# Overlap preserves context across chunk boundaries
# Chunk at sentence boundaries where possible
# Never split mid-sentence

from langchain.text_splitter import RecursiveCharacterTextSplitter
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", ". ", " "]
)
chunks = splitter.split_text(cleaned_text)
```

#### Step 4 — Embedding Generation
```python
# OpenAI text-embedding-3-small
# 1536 dimensions
# $0.02 per million tokens
# Cheapest embedding model, good enough for RAG

import openai
embeddings = []
for chunk in chunks:
    response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=chunk
    )
    embeddings.append(response.data[0].embedding)
```

#### Step 5 — Storage
```python
# Store each chunk with its embedding
for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
    supabase.table('wiki_chunks').insert({
        'document_id': document_id,
        'pillar': pillar,
        'chunk_index': i,
        'content': chunk,
        'embedding': embedding,
        'token_count': len(chunk.split()) * 1.3  # estimate
    }).execute()

# Update document record
supabase.table('wiki_documents').update({
    'processed': True,
    'processed_at': datetime.utcnow().isoformat(),
    'chunk_count': len(chunks)
}).eq('id', document_id).execute()
```

### Semantic Retrieval At Session Time
When Claude needs wiki context for a session response:

```python
# 1. Embed the current session context
session_context = f"{current_message} {last_3_messages}"
response = openai.embeddings.create(
    model="text-embedding-3-small",
    input=session_context
)
query_embedding = response.data[0].embedding

# 2. Cosine similarity search in pgvector
# Returns top 5 most relevant chunks for this pillar
result = supabase.rpc('match_wiki_chunks', {
    'query_embedding': query_embedding,
    'pillar_filter': current_pillar,
    'match_count': 5,
    'similarity_threshold': 0.75
}).execute()

# 3. Inject into Claude context window
wiki_context = "\n\n".join([
    f"Source: {chunk['document_title']}\n{chunk['content']}"
    for chunk in result.data
])
```

Supabase RPC function (pgvector):
```sql
CREATE OR REPLACE FUNCTION match_wiki_chunks(
  query_embedding vector(1536),
  pillar_filter text,
  match_count int,
  similarity_threshold float
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  document_title text,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    wc.id,
    wc.document_id,
    wd.title as document_title,
    wc.content,
    1 - (wc.embedding <=> query_embedding) as similarity
  FROM wiki_chunks wc
  JOIN wiki_documents wd ON wc.document_id = wd.id
  WHERE wc.pillar = pillar_filter
    AND 1 - (wc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY wc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Vector index for fast similarity search
CREATE INDEX ON wiki_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Admin Panel — Wiki Management
Protected route: /admin/wiki
Access: admin role only (is_admin flag on users table)
During testing: only Rafay has access

Features:

File upload:
- Drag and drop or file picker
- Any file type, any size
- Multipart upload for files over 100MB
- Progress bar showing upload + processing status
- Pillar selector — assign document to pillar
- Type selector — book/article/white-paper/etc
- Upload triggers R2 → Worker → FastAPI automatically

URL import:
- Paste any URL
- FastAPI fetches, extracts, stores in R2
- Same processing pipeline as file upload
- Preview of extracted text before confirming

Document library:
- List of all documents per pillar
- Processing status (pending/processing/complete/failed)
- Chunk count per document
- Option to reprocess if extraction failed
- Option to delete (removes from R2, chunks, embeddings)
- Relevance score editor — manually adjust per document

Processing queue:
- Live view of documents currently being processed
- Estimated completion time
- Failed documents with error reason

### Admin Panel — Visual Design
Same design language as the product.
Dark glass surfaces. Neue Montreal throughout.
No Canela — this is a utility screen, not Axiom's voice.
Accessible only via /admin — no link from main app.

### User Contributions (V2)
Not built until v1 is stable with paying users.
When activated:

Users can suggest sources via a simple form:
- URL or file upload
- Which pillar they think it belongs to
- Why they think it's relevant (optional)

Suggestion goes into a review queue in the admin panel.
Team reviews before anything enters the wiki.
Accepted: processed through normal pipeline
Rejected: removed silently, no notification to user

Quality bar stays high. The wiki's value comes from
curation, not volume. A bad source that confuses
Axiom's responses is worse than no source at all.

### New Environment Variables Required
Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=axiom-wiki
R2_PUBLIC_URL=
Cloudflare Worker
WORKER_SECRET=
OpenAI (embeddings only)
OPENAI_API_KEY=
Admin
ADMIN_SECRET=

### Cost Summary — Wiki Infrastructure
Cloudflare R2 storage (up to 10GB):    $0/month
Cloudflare R2 requests:                $0/month (free tier)
Cloudflare Worker:                     $0/month (free tier)
Supabase pgvector (free tier):         $0/month
OpenAI embeddings (build cost):        ~$1.50 one time
OpenAI embeddings (per session):       ~$0.000002/session
Total wiki infrastructure:             ~$0/month

### Processing Time Estimates
Short article (2,000 words):     ~5 seconds
Long article (10,000 words):     ~15 seconds
White paper (50 pages):          ~45 seconds
Full book (300 pages):           ~3 minutes
Large financial audit (500pg):   ~5 minutes

All processing runs asynchronously.
Admin panel shows live status.
Document is searchable immediately after processing completes.

---

## Intelligence Layer

### Philosophy
Every Claude API call in Axiom is a carefully constructed
context window. Claude has no memory between calls. Axiom's
job is to make sure every call contains exactly what Claude
needs to respond as if it remembers everything.

### Streaming
All session response calls stream token by token.
FastAPI uses Claude's streaming API (stream=True).
Next.js consumes the stream and renders tokens as they arrive.
No blank screen wait. Sessions feel live and immediate.

Non-streaming calls (background, end of session):
opening read, experiment generation, theory update,
node/edge creation, session summarization, warning
delivery, reapplication evaluation.

### Rate Limiting
Per user per session: maximum 50 messages.
Per user per day: maximum 5 sessions.
Enforced at two levels:
1. FastAPI middleware — checked before every Claude API call
2. Database trigger — hard insert rejection at DB level
If session limit hit: Axiom closes session gracefully,
references active experiments, tells user to return tomorrow.
If daily limit hit: user sees a holding screen until midnight UTC.

### Context Window Management
Every API call constructed in priority order.
Token estimation: character count ÷ 4, rounded up.
Target: stay under 180,000 tokens (200,000 max, 20,000 buffer).

If estimated tokens exceed 180,000, trim in this order:
Priority 1 — never trimmed:
  System prompt, current task instruction, user theory summary
Priority 2 — trim oldest first, keep last 3 minimum:
  Session summaries
Priority 3 — trim to last 20 messages if needed:
  Current session transcript
Priority 4 — summarize into single paragraph if needed:
  Experiment history

For users with 6+ months of history:
  Archived summaries excluded from context construction.
  Only last 6 months of non-archived summaries used.
  Full history retained in DB — never deleted.

FastAPI tracks token count before every call and logs
estimated usage per call type to Railway for cost monitoring.

### Call Types

#### 1. Opening Read
Triggered: every returning user session open
Context sent:
- System prompt (opening read variant)
- User theory summary
- Last 3 non-archived session summaries
- Active experiment statuses and days elapsed
- Node and edge count per pillar
- Overall maturity stage

Output: 1-2 sentence opening read, array of 1-3 node IDs to highlight

Constraints:
- Must reference something specific to this user
- Must create urgency or clear direction
- Never a generic greeting
- Axiom decides statement vs question based on context
- Always personal — never applicable to any other user
- Maximum 40 words

#### 2. Session Response
Triggered: every user message during a session
Context sent:
- System prompt (tutor variant) with entry type flag
- User theory
- Last 5 non-archived session summaries
- Full current session transcript
- Active experiments with days elapsed
- Relevant personal wiki entries (top 3 by relevance to topic)
- Relevant global wiki entries (top 2 by pillar match)

Output: Axiom's response, streamed token by token

Situation-based constraints:
- Identifies pattern before user names it
- Responds through relevant pillar lens
- Never closes a loop without opening one
- Builds toward experiment at natural session close

Curiosity-based constraints:
- Teaches through user's specific context — never generic
- Pulls from personal and global wiki for grounding
- Always ends with a "now what" — never pure information
- Still builds toward an experiment at session close

Shared constraints:
- Adaptive tone — reads user energy and mirrors it
- No filler, no affirmations, no chatbot language
- Forbidden phrases: "great question", "certainly",
  "I understand", "that's interesting", "absolutely",
  "of course", "I'd be happy to", "great"
- Response length matches message complexity
- First name used maximum once per session, never performatively

#### 3. Session Summarization
Triggered: immediately after session ends
Runs before: theory update, node/edge creation
Context sent:
- System prompt (summarizer variant)
- Full session transcript

Output: structured JSON summary object
Fields: main_topic, pillars_touched, key_insight,
experiment_assigned_id, user_energy, created_at

Constraints:
- key_insight must be specific — names the actual pattern
- user_energy read from tone and message length patterns
- Output must be valid JSON — retry once if malformed

#### 4. Theory Update
Triggered: after session summarization completes
Context sent:
- System prompt (theory builder variant)
- Full session transcript
- Current user_theory record (full)
- Last 5 non-archived session summaries
- Experiment outcomes since last theory update

Output: complete updated user_theory JSON object

Constraints:
- Theory only deepens — never resets
- New contradictions append, resolved ones marked resolved
- Maturity scores move up only on experiment completion,
  not on concept discussion alone
- Output must be valid JSON matching user_theory schema
- FastAPI validates schema before writing to DB
- On invalid JSON: retry once with schema appended explicitly
- theory_version incremented on every successful write

#### 5. Node And Edge Creation
Triggered: after session summarization completes,
  runs in parallel with theory update
Context sent:
- System prompt (graph builder variant)
- Full session transcript
- All existing node labels for this user (for dedup)
- All existing edge pairs for this user (for dedup)

Output: JSON array of new nodes, JSON array of new edges

Node object fields:
- pillar, label, state (always dim on creation),
  insight_text, sphere_x, sphere_y, sphere_z

Edge object fields:
- node_a_id, node_b_id, pillar_a, pillar_b,
  insight_text, has_unread_insight (always true on creation)

Sphere coordinate generation:
- Nodes placed on sphere surface using Fibonacci sphere
  algorithm for even distribution
- Pillar grouping: nodes of same pillar cluster within
  a 60 degree arc of each other on the sphere
- New nodes placed in pillar's arc, avoiding overlap
  with existing nodes (minimum 0.15 unit separation)
- Coordinates generated by FastAPI after Claude returns
  node list — not by Claude

Constraints:
- Nodes created only for concepts genuinely engaged with
  across multiple messages — not mentioned once in passing
- Edges created only when specific personal insight
  links two nodes — never auto-generated
- Insight text always personal — references user's situation
- Node label maximum 3 words
- Duplicate check before any DB write
- Both outputs must be valid JSON — retry once if malformed

#### 6. Experiment Generation
Triggered: Claude signals session is naturally closing
  (detected via session response call output flag)
Context sent:
- System prompt (experiment generator variant)
- User theory
- Full current session transcript
- Active experiment count and details
- Personal wiki — avoids repeating covered concepts
- Top 3 relevant global wiki entries by pillar

Output: experiment text, example text, window_hours (int)

Constraints:
- User is the only variable — zero external dependencies
- Specific to this session's situation — never generic
- Window 24-168 hours based on experiment complexity
- Example subject: "someone" or "a person" — no titles
- Example outcome cut short — tension preserved
- If 2 experiments already active: output flag "cap_reached",
  no experiment generated, session closes referencing
  existing active experiments instead

#### 7. Experiment Negotiation
Triggered: user pushes back on an assigned experiment
Context sent:
- System prompt (negotiation variant)
- The original experiment (full text)
- User's pushback reason (current message)
- User theory — specifically pushback_patterns field
- Full negotiation_log for this experiment

Output: decision (hold / replace), response text,
  updated negotiation_log entry

Constraints:
- Default position: hold
- Vague reasons rejected directly — no softening
- Maximum 3 negotiation rounds per experiment
- After round 3: Axiom holds final, closes negotiation,
  does not engage further on this experiment's terms
- If replacing: new experiment must differ meaningfully
  from original — same concept in different form rejected
- Every round logged to negotiation_log regardless of outcome
- Output must include updated log entry for DB write

#### 8. Warning Delivery
Triggered: background job queues warning, delivered on
  next session open — replaces opening read
Context sent:
- System prompt (warning variant)
- Warning number (1 or 2)
- Specific ghosted experiment(s) that triggered warning
- User theory — for personalization

Output: warning message text

Constraints:
- Warning 1: direct, firm, experiment-specific
- Warning 2: sharper, consequence stated explicitly
- Never customer service tone
- Never apologetic or softened
- Always names the specific experiment ghosted
- Maximum 60 words
- After generation: stored in warnings table,
  Resend triggered to send backup email simultaneously

#### 9. Reapplication Evaluation
Triggered: removed user submits reapplication form
Context sent:
- System prompt (reapplication evaluator variant)
- Original removal reason (from removal record)
- User's written response
- Full experiment history (counts, ghost rate)
- Full warning history

Output: decision (accepted / declined), internal reasoning

Constraints:
- Vague responses: declined, no explanation to user
- Generic reflection without evidence: declined
- Specific behavioral evidence required for acceptance
- Decision logged with internal reasoning (not shown to user)
- On accept: account reinstated, all data restored,
  subscription reactivated, onboarding skipped
- On decline: reapplication_eligible_at remains,
  user can try again (no lockout on declined applications)

### System Prompt Architecture

Base prompt (shared across all variants):
- What Axiom is — one paragraph
- The 6 pillars and their domains — table format
- Axiom's voice rules — explicit list
- Forbidden phrases — explicit list
- User context block:
  - First name
  - Overall maturity stage
  - Active experiment count
  - Days since first session

Each variant appends:
- Specific task instruction
- Output format — plain text or JSON schema
- Call-specific constraints
- Examples of good vs bad output for this call type

System prompts stored in FastAPI as versioned constants.
Version number logged with every API call.
Changes to system prompts treated as deployments —
tested in staging before production push.

### Error Handling
All Claude API calls wrapped in try/except with:

Timeout (>30 seconds):
  Retry once after 3 seconds.
  If retry fails: surface neutral holding message to user.
  Log full context to Railway error log.

Malformed JSON output:
  Retry once with explicit schema appended to prompt.
  If retry fails: log and skip write, session continues.

Context window exceeded (400 error):
  Trim per priority order, retry immediately.

Anthropic rate limit (429 error):
  Queue call, retry after 60 seconds.
  Notify user of brief delay via frontend holding state.

Any 5xx from Anthropic:
  Retry after 10 seconds, maximum 2 retries.
  If all fail: graceful degradation — session pauses,
  user informed, session state preserved in DB.

All errors logged to Railway with:
  - Call type
  - Estimated token count
  - Error code and message
  - Timestamp
  Never log user message content to external services.

---

## Founder Brain — Technical Implementation

### Philosophy
The sphere is the product's most visible surface.
It must feel alive, responsive, and fast regardless
of how many nodes a user accumulates over time.

### Three.js Implementation

Library: Three.js r155 (web), expo-gl + Three.js (native, v2)
Renderer: WebGLRenderer with antialiasing enabled
Scene: black background (hex #000000), fog disabled
Camera: PerspectiveCamera, FOV 75, positioned at sphere center

### Sphere Construction
Radius: 5 units
User camera position: (0, 0, 0) — inside the sphere
Nodes rendered on sphere surface at stored coordinates
Navigation: OrbitControls with the following config:
  - enablePan: false (no panning, only rotation)
  - minDistance: 0 (can be fully inside)
  - maxDistance: 12 (zoom out to see full sphere externally)
  - autoRotate: true for first 3 seconds on open,
    then disabled
  - rotateSpeed: 0.4
  - zoomSpeed: 0.6
  - enableDamping: true, dampingFactor: 0.05

### Node Rendering
Geometry: SphereGeometry(0.08, 16, 16) for dim nodes
           SphereGeometry(0.1, 16, 16) for bright nodes
Material: MeshStandardMaterial

Pillar colors and symbols:
| Pillar | Color | Hex | Symbol |
|---|---|---|---|
| The Money Game | Gold | #F5C518 | $ |
| The Human Mind | Purple | #9B59B6 | ψ |
| How Companies Win | Blue | #2E86C1 | ◈ |
| What's Coming | Green | #27AE60 | ⟡ |
| Think Sharper | White | #ECF0F1 | ◎ |
| Move People | Red | #E74C3C | ↑ |

Dim node: pillar color at 40% opacity
Bright node: pillar color at 100% opacity, subtle point
  light emitting from node center (intensity 0.3)
Highlighted node (Axiom suggestion): pillar color at 100%
  opacity + animated pulse scale (1.0 → 1.3 → 1.0, 1.5s loop)
  + directional beam from camera toward node

Node label: rendered as HTML overlay via CSS2DRenderer,
  positioned below node, 10px font, pillar color,
  always faces camera (billboarding)
  Visible only when node is within 3 units of camera
  or when node is highlighted

### Edge Rendering
Geometry: TubeGeometry along quadratic bezier curve
  between two node positions
Material: LineBasicMaterial, 20% opacity by default
  Pulse animation when has_unread_insight is true:
  opacity cycles 20% → 60% → 20% over 2 seconds

### Level of Detail (LOD) Strategy
Users accumulate nodes over months. Without LOD,
performance degrades significantly above 150 nodes.

LOD implementation:
- Nodes within 3 units of camera: full geometry + label
- Nodes 3-6 units from camera: simplified geometry
  (SphereGeometry(0.06, 8, 8)), no label
- Nodes beyond 6 units: rendered as Points geometry
  (single pixel), no label
- Edges only rendered between nodes both within 5 units
  of camera — distant edges hidden

LOD recalculated every frame using camera position.
Three.js LOD class used for automatic level switching.
Target: maintain 60fps up to 500 nodes on mid-range hardware.

### Sphere Update on Session End
After FastAPI writes new nodes and edges to Supabase:
Next.js fetches updated node and edge lists via REST call.
New nodes animate in — scale from 0 to full size over 0.5s
  with pillar color fade in.
New edges animate in — tube grows from node_a to node_b
  over 0.8s.
Existing nodes that brightened animate — opacity pulse
  from 40% to 100% over 1s, point light activates.
All animations use Three.js AnimationMixer.

### Shareable Brain Snapshot
User requests share → FastAPI generates signed Supabase
  Storage upload URL → Next.js renders sphere to offscreen
  canvas using WebGLRenderer with preserveDrawingBuffer: true
  → canvas.toBlob() captures PNG → uploaded to Supabase Storage
  → public URL returned to user for sharing.
Snapshot dimensions: 1200x1200px for social sharing compatibility.
Snapshots stored at: brain-snapshots/{user_id}/{timestamp}.png
Retention: 30 days, then auto-deleted via Supabase Storage policy.

---

## Background Jobs

All 4 jobs run on Railway as separate Python processes.
Scheduler: APScheduler (AsyncIOScheduler).
Each job logs start, completion, and any errors to Railway.

### Job 1 — Experiment Window Tracker
Schedule: every 6 hours
Function:
  Query all active experiments where due_at < now()
  For each overdue experiment:
    If follow_up_count < 2:
      Increment follow_up_count
      Queue follow-up reference for next session open
      Update experiment record
    If follow_up_count >= 2:
      Mark experiment status = ghosted
      Set ghosted_at = now()
      Trigger Job 3 (Warning Trigger) for this user
Error handling: log failures, retry next scheduled run

### Job 2 — Session Count Reset
Schedule: daily at 00:00 UTC
Function:
  UPDATE users SET session_count_today = 0
  Log completion
Error handling: retry after 5 minutes if fails

### Job 3 — Warning Trigger
Schedule: event-driven — triggered by Job 1
  Also runs on schedule every 12 hours to catch any missed
Function:
  Query users where new ghosted experiments exist
  and no warning queued for this ghost event
  For each user:
    Count consecutive ghosted experiments
    If count >= 2 and no Warning 1 on record:
      Call Claude API (warning delivery call type, warning 1)
      Store warning in warnings table
      Set delivered_at = null (pending delivery on next open)
      Trigger Resend email — Warning 1 backup
    If count >= 2 after Warning 1 and no Warning 2:
      Call Claude API (warning delivery call type, warning 2)
      Store warning in warnings table
      Trigger Resend email — Warning 2 backup
    If Warning 2 already delivered and new ghost:
      Trigger Job 4 (Removal Trigger) for this user
Error handling: log per user failure, continue to next user

### Job 4 — Removal Trigger
Schedule: event-driven — triggered by Job 3
Function:
  For each user flagged for removal:
    Set users.removed_at = now()
    Set users.subscription_status = removed
    Set users.removal_reason = logged reason
    Set users.reapplication_eligible_at = now() + 90 days
    If users.created_at > now() - 15 days:
      Set users.refund_issued = true
      Set users.refund_issued_at = now()
      Call Lemon Squeezy refund API (when active)
      If testing mode: log refund, skip API call
    Trigger Resend email — removal notice with refund
      status and reapplication date
    Log removal record to Railway
Error handling: log failure, flag for manual review —
  removal is a legal commitment, failures must be resolved

### Job 5 — Summary Archival
Schedule: weekly, Sunday 02:00 UTC
Function:
  UPDATE session_summaries SET archived = true
  WHERE created_at < now() - interval '6 months'
  AND archived = false
  Log count of archived summaries
Error handling: retry next Sunday if fails

---

## Global Wiki Pipeline

### Content Entry
Two paths into global_wiki:

Path 1 — Manual (team):
  Team member prepares content object:
    pillar, title, type, content summary, relevance_score
  Runs duplicate check against existing titles
  If no duplicate and relevance_score >= 0.7: inserts
  If duplicate or low score: rejected with reason logged

Path 2 — System flagged (concept frequency):
  Background job (weekly) queries messages table
  Counts concept mentions across all users per pillar
  Concepts appearing in 50+ sessions flagged for review
  Team reviews flagged concepts and decides on entry
  No auto-entry — team approval always required

### Content Serving
Global wiki served to Claude via FastAPI context construction.
Never served as a browsable interface to users.
FastAPI queries global_wiki by pillar, ordered by
relevance_score DESC, limits to top 5 entries per call.
Personal wiki queried by user_id and pillar match,
top 3 entries included in session response context.

---

## Deployment Architecture

### Frontend (Vercel)
Framework: Next.js 14 (App Router)
Deployment: Vercel via GitHub integration — push to main
  triggers production deploy automatically
Environment variables set in Vercel dashboard:
  NEXT_PUBLIC_API_URL — Railway FastAPI base URL
  NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon key
Route warming: Vercel cron job pings critical routes
  every 5 minutes to prevent cold starts:
  /api/health, /api/session/open
Preview deployments enabled for all PRs — never merge
  without testing in preview first

### Backend (Railway)
Runtime: Python 3.11
Framework: FastAPI with Uvicorn
Deployment: Railway via GitHub integration — push to main
  triggers production deploy automatically
Environment variables set in Railway dashboard:
  ANTHROPIC_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  RESEND_API_KEY
  LEMON_SQUEEZY_WEBHOOK_SECRET (set when payments activate)
  ENVIRONMENT (production / development)
Railway services:
  1. FastAPI web service — handles all API requests
  2. Background jobs service — runs APScheduler jobs
     as separate Railway service, not in FastAPI process
Healthcheck endpoint: GET /health — Railway monitors this,
  restarts service if healthcheck fails 3 times in a row
Zero downtime deploys: Railway rolling restart configured

### Database (Supabase)
Project region: closest to Railway deployment region
  to minimize latency on DB calls
PgBouncer: enabled in transaction pooling mode
  FastAPI uses pooled connection string exclusively
  Direct connection string used only for migrations
Backups: Supabase daily automated backups enabled
  Point-in-time recovery enabled (Supabase Pro)
Migrations: managed via Supabase CLI
  Migration files committed to git in /supabase/migrations
  Never run raw SQL in production — always through migration
RLS: enabled on all tables from day one

### CI/CD
GitHub repository with two branches:
  main — production
  develop — staging

Pull request flow:
  1. Feature branch created from develop
  2. PR opened against develop
  3. Vercel preview deployment auto-created
  4. Review in preview environment
  5. Merge to develop — staging deploy
  6. Test in staging
  7. PR from develop to main — production deploy

No direct pushes to main ever.
Environment parity: staging uses separate Supabase project,
  separate Railway environment, same codebase.

---

## Security Architecture

### Authentication Flow
1. User signs up / logs in via Supabase Auth
   (email + password or Google OAuth)
2. Supabase issues JWT access token (1 hour expiry)
   and refresh token (30 days expiry)
3. Next.js stores tokens in httpOnly cookies —
   never in localStorage, never exposed to JavaScript
4. Every request from Next.js to FastAPI includes
   JWT in Authorization header
5. FastAPI validates JWT against Supabase public key
   on every single request — no exceptions
6. If JWT expired: Next.js runs silent refresh before retry
7. If refresh token expired: user logged out, redirected
   to login with session state preserved where possible

### API Key Management
- All secrets stored in Railway environment variables
- Never hardcoded, never in version control
- .env.local gitignored — .gitignore enforced in CI
- Only NEXT_PUBLIC_ prefixed keys exposed to browser
- Rotation policy: all keys rotated every 90 days
- Anthropic API key has spend limit set in Anthropic dashboard
  as cost protection — alerts at 80% of limit

### CORS
FastAPI CORS middleware:
  allowed_origins: [VERCEL_PRODUCTION_URL, "http://localhost:3000"]
  allow_credentials: true
  allowed_methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  allowed_headers: ["Authorization", "Content-Type"]
  No wildcard origins. Ever.

### Data Privacy
- User message content never sent to external logging services
- Railway logs contain only metadata — call type, token count,
  error codes — never message content
- Supabase data encrypted at rest (Supabase default)
- All traffic encrypted in transit (HTTPS enforced everywhere)
- User theory and session data accessible only to that user
  via RLS — not even team can query without service role key
- Service role key accessible only to Railway backend services

---

## Scalability Considerations & Solutions

### Risk 1 — Three.js Performance With Large Graphs
Problem: users with 200+ nodes after 6 months see
  frame rate degradation in the sphere.
Solution: LOD strategy implemented from day one (see
  Founder Brain section). Target 60fps at 500 nodes.
  Monitor: track average node count per user monthly.
  Threshold: if median user reaches 300 nodes, audit
  LOD thresholds and optimize geometry further.

### Risk 2 — Claude API Costs At Scale
Problem: 9 call types per session × 5 sessions/day × 1000
  users = significant daily API spend.
Solution implemented:
  1. Token logging per call type in Railway — full cost
     visibility from day one
  2. Session summarization reduces context size for
     long-term users significantly
  3. Summary archival after 6 months keeps context
     windows lean for power users
  4. Rate limiting (50 messages, 5 sessions/day) caps
     worst-case spend per user
  5. Anthropic spend limit set in dashboard as hard cap
Cost projection (approximate at launch):
  Average session: ~8000 tokens in, ~800 tokens out
  9 calls per session: ~72,000 tokens per session
  claude-sonnet-4: $3/M input, $15/M output
  Cost per session: ~$0.23 input + $0.011 output ≈ $0.24
  At $39/month subscription: break-even at ~163 sessions/month
  (~5.4 sessions/day) — rate limit of 5/day keeps this safe
  Monitor monthly and adjust rate limits if needed.

### Risk 3 — Supabase Connection Exhaustion
Problem: FastAPI on Railway with concurrent users exhausts
  Supabase's direct connection limit quickly.
Solution: PgBouncer in transaction pooling mode enabled
  from day one. All FastAPI DB calls use pooled connection
  string. Direct connection reserved for migrations only.
  Monitor: Supabase connection count dashboard.
  Threshold: if pool utilization exceeds 80%, upgrade
  Supabase plan or implement connection queue in FastAPI.

### Risk 4 — Vercel Cold Starts
Problem: Next.js serverless functions on Vercel have cold
  start latency — bad for first impression on a product
  where the opening experience matters.
Solution:
  1. Vercel cron job warms critical routes every 5 minutes
  2. Next.js App Router with React Server Components reduces
     JS bundle size — faster initial load
  3. Three.js sphere loaded asynchronously — core UI renders
     first, sphere hydrates after
  4. Consider Vercel Pro fluid compute if cold starts persist
     beyond acceptable threshold in production.

### Risk 5 — Session Transcript Size
Problem: heavy users with long sessions generate large
  transcripts that bloat context windows and slow API calls.
Solution:
  1. Hard 50 message limit per session enforced at DB level
     via trigger — cannot be bypassed at application level
  2. Token count stored per message — FastAPI can calculate
     exact session size before constructing context
  3. Priority trimming system clips transcript to last 20
     messages if context approaches limit
  4. Session summarization means future sessions reference
     the summary, not the raw transcript

---

## Cost Optimisation

### 1. Opening Read Cache
Every app open triggers a Claude API call to generate the opening
read. A user who opens the app multiple times without starting a
session generates multiple identical calls wastefully.

Implementation:
- After generating an opening read, store it in Supabase against
  the user record with a generated_at timestamp
- On every app open, FastAPI checks if a cached opening read exists
  and was generated within the last 6 hours
- If yes: serve cached version from Supabase — zero Claude API call
- If no, or if a session has completed since last generation:
  generate fresh, store new cached version
- Cache invalidated immediately after a session completes —
  next open always gets a fresh read reflecting what happened

New field added to users table:
| Field | Type | Description |
|---|---|---|
| opening_read_cache | text | Last generated opening read |
| opening_read_cached_at | timestamptz | When it was generated |

Net effect: ~70% reduction in opening read API calls for
users who open the app multiple times daily.

### 2. Prompt Caching (Anthropic)
The base system prompt and user theory object are sent at the
start of every Claude API call. These are identical across all
calls within a session — sending them at full price every time
is wasteful.

Anthropic prompt caching charges cached input tokens at
$0.30/million instead of $3/million — a 90% discount.
Cache duration: 5 minutes on Anthropic's servers.

Implementation:
- System prompt marked with cache_control: {"type": "ephemeral"}
- User theory block marked with cache_control: {"type": "ephemeral"}
- On first call of a session: full price for these blocks
- All subsequent calls in the same session: 90% discount
  on system prompt and theory tokens
- FastAPI logs cache hit/miss per call to Railway for monitoring

Which calls benefit most:
- Session response calls (up to 50 per session) — highest impact
- Theory update, node/edge creation, summarization — moderate impact
- Opening read, warning delivery — low impact (infrequent)

Net effect: ~60% reduction in input token costs across all
calls within an active session.

### Combined Optimisation Impact
Without optimisations:
- Input cost per session: ~$0.33 (in-session) + $0.072 (end) = $0.40
With both optimisations:
- Prompt caching cuts in-session input cost by ~60%: ~$0.13 + $0.072
- Opening read cache eliminates ~70% of opening read calls
- Effective cost per session: ~$0.21
- Monthly cost per user at 5 sessions/day:
  $0.21 × 5 × 30 = $31.50/month in Claude API costs alone

This means at 5 sessions/day the product runs near break-even
on Claude costs at $39/month. Real-world average sessions will
be 1-3/day for most users, not 5 — making the actual margin
significantly healthier than worst-case projections.

Monitor: Railway logs token usage and cache hit rate per call type.
Review monthly. Adjust context construction if cache hit rate
drops below 70% on session response calls.

---

## Payments (Lemon Squeezy — Inactive Until Launch)

Integration built but feature-flagged off during testing.
Activated by setting LEMON_SQUEEZY_WEBHOOK_SECRET in Railway
and flipping payment_active flag in FastAPI config.

### Webhook Events Handled
subscription_created:
  Set users.subscription_status = active
  Set users.lemon_squeezy_customer_id

subscription_cancelled:
  Set users.subscription_status = cancelled
  User retains access until end of billing period

subscription_expired:
  Set users.subscription_status = expired
  Restrict access to app immediately

refund_created:
  Set users.refund_issued = true
  Set users.refund_issued_at = now()
  Log to removal record

### Refund Logic
Refunds triggered by Job 4 (Removal Trigger) when:
  users.created_at > now() - 15 days
In testing mode: refund logged, Lemon Squeezy API not called.
In production: FastAPI calls Lemon Squeezy refund endpoint,
  logs result, updates refund_issued fields.
Failed refund calls: flagged for manual review immediately —
  refunds are a legal commitment.

---

## Email (Resend)

Used for: Warning 1 backup, Warning 2 backup,
  Removal notice, Reapplication decision.
Not used for: marketing, onboarding, general notifications.

### Email Templates

Warning 1:
  Subject: "You're on notice."
  Body: Axiom's warning 1 message text (from warnings table)
  + restatement of the ghosted experiment

Warning 2:
  Subject: "Last warning."
  Body: Axiom's warning 2 message text + explicit statement
  that next miss closes the account

Removal:
  Subject: "Your Axiom access is closed."
  Body: removal reason + refund status (if applicable)
  + reapplication date + reapplication instructions

Reapplication accepted:
  Subject: "You're back."
  Body: one line confirmation, no fanfare

Reapplication declined:
  Subject: "Not yet."
  Body: one line decline, no explanation, no appeal process

All emails sent from: axiom@[domain]
All templates stored as constants in FastAPI — not in
  external template service. Axiom's voice maintained
  in email copy — never softened, never generic.

## Future Considerations

### Axiom Circle — Matching Layer (V2)
Not built until 10,000 paying users.
Documented here so architectural decisions now
don't paint us into a corner later.

#### What It Needs
A matching pipeline that operates on accumulated
user_theory data across all users who have opted
into Axiom Circle.

#### Data Requirements
- Minimum 60 sessions per user before eligible for matching
- user_theory record must have all 6 pillar maturity
  scores populated
- User must have completed at least 10 experiments
- User must have explicitly activated Axiom Circle
  and be paying the $20/month add-on

#### Matching Logic (High Level)
- Pull all eligible users from Supabase
- For each user, generate a complement profile —
  the inverse of their strengths across all 6 pillars
- Score all other eligible users against the
  complement profile — highest scorer is the match
- Weights: pillar maturity (40%), blind spots (30%),
  pushback patterns (20%), execution rate (10%)
- Match is one-to-one — not a list of suggestions
- Rematch available after 6 months or if either
  user opts out

#### New Tables Required
circle_memberships:
  user_id, activated_at, eligible_at, current_match_id,
  matched_at, subscription_status

circle_matches:
  id, user_a_id, user_b_id, matched_at,
  compatibility_score, match_reasoning (internal),
  status (active/ended)

#### Privacy
- Matching computation happens server-side only
- No raw user_theory data shared between matched users
- Users see: match's first name, overall maturity stage,
  and a one-line Axiom-generated reason for the match
- Full theory remains private always

#### Cost Consideration
Matching computation runs weekly as a background job.
One Claude API call per eligible user pair comparison
would be prohibitively expensive at scale.
Use embedding-based similarity instead:
- Generate embeddings from user_theory JSON
  using text-embedding-3-small (OpenAI) or
  Claude's future embedding API
- Store embeddings in Supabase pgvector extension
- Cosine similarity for complement scoring
- Claude API called only for match_reasoning
  generation — once per match, not per comparison
