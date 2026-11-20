import { HttpContextToken } from '@angular/common/http';

/** When true, send cookies on a Basic-auth request to establish a Nuxeo browser session. */
export const NUXEO_ESTABLISH_BROWSER_SESSION = new HttpContextToken<boolean>(() => false);

/** Use only browser cookies, including while a separate Basic session is active in Satori. */
export const NUXEO_COOKIE_SESSION_ONLY = new HttpContextToken<boolean>(() => false);
