/**
 * Cloudflare Pages Function: relays /api/<action> to the Apps Script web app.
 *
 *   POST /api/init    → page load data (teams + rosters)
 *   POST /api/submit  → submit a match
 *   POST /api/ping    → setup test
 *
 * Needs two environment variables (Cloudflare dashboard → this Pages project →
 * Settings → Variables and Secrets, type "Secret"):
 *   APPS_SCRIPT_URL  the web app's /exec URL
 *   APPS_SCRIPT_KEY  the key logged by createApiKey() in Apps Script
 *
 * The request to Google comes from Cloudflare's servers, so coaches' Google
 * sign-ins are never involved and the key never reaches the browser.
 */

const ALLOWED_ACTIONS = ['init', 'submit', 'ping'];
const MAX_BODY_BYTES = 100 * 1024; // a full match is ~5 KB

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost({ request, env, params }) {
  const action = params.action;
  if (!ALLOWED_ACTIONS.includes(action)) {
    return json({ success: false, feedback: 'Unknown action.' }, 404);
  }
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_KEY) {
    return json({ success: false, feedback: 'Server is not configured (missing APPS_SCRIPT_URL or APPS_SCRIPT_KEY).' }, 500);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json({ success: false, feedback: 'Request too large.' }, 413);
  }

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      return json({ success: false, feedback: 'Bad request (not JSON).' }, 400);
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return json({ success: false, feedback: 'Bad request.' }, 400);
  }

  // Action and key are set here, never taken from the browser.
  const payload = Object.assign({}, data, { action: action, key: env.APPS_SCRIPT_KEY });

  let upstream;
  try {
    // Apps Script answers POSTs with a redirect to the result; it must be followed.
    upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
  } catch (e) {
    return json({ success: false, feedback: 'Could not reach Google. Please try again.' }, 502);
  }

  const body = await upstream.text();
  try {
    JSON.parse(body); // make sure Google sent JSON, not an HTML error page
  } catch (e) {
    console.log('Non-JSON reply from Apps Script', upstream.status, body.slice(0, 500));
    return json({
      success: false,
      feedback: 'Google returned an unexpected response (status ' + upstream.status + '). Please try again in a minute.'
    }, 502);
  }
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Anything other than POST to /api/* is rejected.
export async function onRequest() {
  return json({ success: false, feedback: 'Use POST.' }, 405);
}
