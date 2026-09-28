import { wireProgram } from './program.js';
import { wireMedia } from './media.js';
import { wireLogo } from './logo.js';

export function wireActions(client, dynamicRefs, groupsMap, messages = {}, settings = null) {
    wireProgram(client, dynamicRefs, groupsMap, messages);
    wireMedia(client, dynamicRefs, groupsMap, messages);
    wireLogo(client, dynamicRefs, groupsMap, messages, settings);
}
