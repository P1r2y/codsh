'use strict';

const READ_CHANNEL = 'codex-usage-ui:read-v1';
const STATE_CHANNEL = 'codex-enhancement-loader:state-v1';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const normalizeThreadId = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

module.exports = { READ_CHANNEL, STATE_CHANNEL, UUID, normalizeThreadId };
