import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ExperimentCard from '../components/ExperimentCard'
import { getApiJson } from '../lib/api'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [threads, setThreads] = useState([])
  const [experiments, setExperiments] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const sessionToken = getStoredSessionToken()
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!sessionToken || !user) {
        clearStoredSessionToken()
        navigate('/', { replace: true })
        return
      }

      const { data: session } = await supabase
        .from('sessions')
        .select('id,user_id')
        .eq('session_token', sessionToken)
        .single()

      if (!session || session.user_id !== user.id) {
        clearStoredSessionToken()
        navigate('/', { replace: true })
        return
      }

      const [threadResult, experimentResult] = await Promise.all([
        supabase
          .from('conversation_threads')
          .select('id,title,last_message_at,updated_at')
          .eq('session_id', session.id)
          .order('last_message_at', { ascending: false }),
        getApiJson(`/api/experiments?session_id=${encodeURIComponent(session.id)}&limit=50&skip_ghosting=1`).catch(() => ({ experiments: [] })),
      ])

      if (cancelled) return
      setEmail(user.email || '')
      setThreads(threadResult.data || [])
      setExperiments((experimentResult.experiments || []).filter((item) => item.status === 'active'))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [navigate])

  function openChat(threadId = crypto.randomUUID(), freshThread = true) {
    navigate('/chat', { state: { fromHome: true, threadId, freshThread } })
  }

  async function signOut() {
    await supabase.auth.signOut()
    clearStoredSessionToken()
    navigate('/', { replace: true })
  }

  if (loading) {
    return <main className="home"><div className="pulse-dot" /></main>
  }

  return (
    <main className="home">
      <header className="home__header">
        <h1>Axiom</h1>
        <button type="button" className="home__signout" onClick={signOut}>Sign out</button>
      </header>

      <section className="home__section">
        <button type="button" className="home__start" onClick={() => openChat()}>Start a conversation</button>
      </section>

      {experiments.length > 0 && (
        <section className="home__section">
          <h2>Active experiment</h2>
          {experiments.map((experiment) => (
            <ExperimentCard
              key={experiment.id}
              {...experiment}
              windowHours={experiment.window_hours}
              dueAt={experiment.due_at}
              howToDoIt={experiment.how_to_do_it}
              realWorldExample={experiment.real_world_example}
              whatToNotice={experiment.what_to_notice}
              successCondition={experiment.success_condition}
              onReport={() => openChat()}
            />
          ))}
        </section>
      )}

      <section className="home__section">
        <h2>Conversations</h2>
        {threads.length === 0 ? (
          <p className="home__empty">No conversations yet.</p>
        ) : (
          <div className="home__threads">
            {threads.map((thread) => (
              <button key={thread.id} type="button" onClick={() => openChat(thread.id, false)}>
                <span>{thread.title || 'Conversation'}</span>
                <time>{new Date(thread.last_message_at || thread.updated_at).toLocaleDateString()}</time>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="home__account">{email}</footer>
    </main>
  )
}
