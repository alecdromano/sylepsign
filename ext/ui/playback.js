import { buildPage } from './builder.js';

export function buildPlaybackPage(settings, client) {
    return buildPage('playback', settings, client);
}
