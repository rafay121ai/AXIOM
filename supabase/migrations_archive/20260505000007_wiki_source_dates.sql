alter table wiki_sources
  add column if not exists published_at timestamptz;

create index if not exists wiki_sources_published_at_idx
  on wiki_sources (published_at desc);
