export function normalizeAuthEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isEmailAddressInvalid(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'email_address_invalid'
    || (message.includes('email address') && message.includes('invalid'));
}

export function authErrorMessage(t, error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '');
  const lowered = message.toLowerCase();
  if (code === 'emailinvalid' || code === 'email_invalid') {
    return t('auth.emailInvalid');
  }
  if (isEmailAddressInvalid(error)) {
    return t('auth.errors.emailInvalid');
  }
  if (!message || message === 'missing' || code === 'missing') {
    return t('auth.errors.missing');
  }
  if (code === 'link_expired' || lowered.includes('otp_expired') || lowered.includes('expired')) {
    return t('auth.errors.link_expired');
  }
  if (code === 'link_used') {
    return t('auth.errors.link_used');
  }
  if (code === 'link_device_mismatch' || lowered.includes('code verifier') || lowered.includes('flow state')) {
    return t('auth.errors.link_device_mismatch');
  }
  if (code === 'link_invalid') {
    return t('auth.errors.link_invalid');
  }
  if (lowered.includes('invalid login') || lowered.includes('invalid credentials')) {
    return t('auth.errors.invalid');
  }
  if (lowered.includes('email not confirmed') || lowered.includes('not confirmed')) {
    return t('auth.errors.unconfirmed');
  }
  if (lowered.includes('already registered') || lowered.includes('already been registered')) {
    return t('auth.errors.exists');
  }
  if (lowered.includes('password')) {
    return t('auth.errors.password');
  }
  if (lowered.includes('network') || lowered.includes('fetch')) {
    return t('auth.errors.network');
  }
  if (lowered.includes('rate limit') || lowered.includes('too many') || code === 'over_email_send_rate_limit') {
    return t('auth.errors.rateLimit');
  }
  return t('auth.errors.generic');
}

export function isUnconfirmedEmailError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('email not confirmed') || message.includes('not confirmed');
}

export function validateEmail(email) {
  const value = normalizeAuthEmail(email);
  if (!value || value.length > 254) {
    return false;
  }
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || domain.length > 253) {
    return false;
  }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) {
    return false;
  }
  if (domain.includes('..')) {
    return false;
  }
  const labels = domain.split('.');
  if (labels.length < 2) {
    return false;
  }
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (!labels.every((label) => labelPattern.test(label))) {
    return false;
  }
  return /^[a-z]{2,}$/i.test(labels[labels.length - 1]);
}

export function validatePassword(password) {
  return String(password || '').length >= 6;
}
