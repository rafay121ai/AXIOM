// The default handler: does nothing (tests and a server with CONNECTORS off). The real one is createSignalHandler in signal.js.
// A kept item (already filtered, fetched fresh, never stored) is handed over as handler(userId, toolkit, item, { repliedTo, createdAt }).
// It must check the account is still active (connector_accounts.status = 'active') before writing, and write nothing for a
// disconnected or needs_reconnect tool. item.injection is true when the text looks like instructions aimed at the model: data only.
// Throwing an error with code 'over_budget' (retryAt: ms, or null to drop) makes the worker requeue or drop the job; see worker.js.
export async function handleItem() {}
