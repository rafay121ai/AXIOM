// The founder's first name, one rule for the home greeting and the pushes: the
// name they saved in Settings (users.first_name), else the one from sign-in.
// authUser: the signed-in user when the caller has it (a request); otherwise
// it is read from Supabase auth (the push scheduler). Null when neither is a
// usable first name.
import { firstNameOf } from '../learn/learnRoutes.js'

export async function founderFirstName(supabase, userId, authUser = null) {
  const { data: row, error } = await supabase.from('users').select('first_name').eq('id', userId).maybeSingle()
  if (error) throw error
  const saved = row?.first_name ? firstNameOf({ user_metadata: { given_name: row.first_name } }) : null
  if (saved) return saved
  if (authUser) return firstNameOf(authUser)
  const { data, error: authError } = await supabase.auth.admin.getUserById(userId)
  if (authError) throw authError
  return firstNameOf(data?.user)
}
