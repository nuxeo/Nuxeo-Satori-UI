import type { EnvironmentProviders } from '@angular/core';
import {
  provideRouter,
  withDisabledInitialNavigation,
  withHashLocation,
  type Routes,
} from '@angular/router';

/**
 * Every path a story's router links point at, each matched by a route that renders nothing. Without
 * a match, following a link fails with NG04002 and the router resets the iframe's URL to the
 * server root, so a reload no longer shows the story.
 */
const STORY_ROUTES: Routes = [{ path: 'browse', children: [] }];

/**
 * The router for stories whose components render router links. Hash location, as the application
 * uses: following a link changes only the iframe's hash, and the story stays on screen. Initial
 * navigation stays off, so no route is needed for the empty path and a hash left by an earlier
 * story is not followed.
 */
export function provideStoryRouter(): EnvironmentProviders {
  return provideRouter(STORY_ROUTES, withHashLocation(), withDisabledInitialNavigation());
}
