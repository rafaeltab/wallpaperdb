const CLERK_ERROR_MESSAGES: Record<string, string> = {
  form_identifier_not_found: 'No account found with this email.',
  form_password_incorrect: 'The password you entered is incorrect.',
  form_password_pwned: 'This password has been compromised in a data breach. Please choose a different one.',
  form_code_incorrect: 'The verification code you entered is incorrect.',
  strategy_for_user_invalid: 'This sign-in method is not available for your account.',
  not_allowed_to_sign_up: 'Sign up is not available right now.',
  not_allowed_access: 'You do not have access to this resource.',
  oauth_access_denied: 'The OAuth provider denied access. Please try again.',
  external_account_not_found: 'No account found linked to this provider.',
  user_locked: 'Your account has been locked. Please contact support.',
  user_banned: 'This account has been suspended.',
  user_deactivated: 'This account has been deactivated.',
  session_exists: 'You are already signed in.',
  sign_up_mode_restricted: 'Sign up is currently restricted.',
  signup_rate_limit_exceeded: 'Too many sign up attempts. Please try again later.',
  device_blocked: 'Your device has been blocked for security reasons.',
  action_blocked: 'This action has been blocked for security reasons.',
  captcha_invalid: 'Verification failed. Please try again.',
};

export function formatClerkGlobalErrors(
  errors: { code: string; longMessage?: string; message: string }[] | null | undefined,
): string | null {
  if (!errors?.length) return null;
  return errors
    .map((e) => CLERK_ERROR_MESSAGES[e.code] ?? e.longMessage ?? 'Something went wrong. Please try again.')
    .join(', ');
}