// The console is a single-page app: Express serves the fallback page and
// the JSON API; nothing is rendered on the server.
export const ssr = false;
export const prerender = false;
// Today's URLs have no trailing slash (/devices, /settings?tab=auth)
export const trailingSlash = 'never';
