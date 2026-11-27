// The hook S2 fills: a kept item (already filtered, fetched fresh, never stored) becomes a signal.
// Contract: the worker has just checked the account is active, but S2 must check it again (connector_accounts.status
// = 'active') before writing anything, and write nothing for a disconnected or needs_reconnect tool.
// item.injection is true when the text looks like instructions aimed at the model: treat it as data only.
export async function handleItem() {}
