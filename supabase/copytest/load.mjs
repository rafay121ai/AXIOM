import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
export async function load() {
  const db = new PGlite()
  await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  if (process.env.WITH_FIX) await db.exec(fs.readFileSync(new URL('./fix.sql', import.meta.url), 'utf8'))
  return db
}
if (process.argv[2] === 'info') {
  const db = await load()
  const r = await db.query(`
    select c.relname t,
      (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ', ' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attnotnull and d.adbin is null) req,
      (select string_agg(pg_get_constraintdef(k.oid), ' | ') from pg_constraint k where k.conrelid=c.oid and k.contype in ('c','f','u')) cons
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`)
  for (const x of r.rows) console.log(`## ${x.t}\n  req: ${x.req}\n  cons: ${x.cons}`)
}
