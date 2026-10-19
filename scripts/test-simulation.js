import assert from 'node:assert/strict';
import { Translator } from '../src/translate.js';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
const translator = new Translator({ ...config({}), apiKey: 'local-fixture', apiBase: 'http://127.0.0.1:4900/openai/v1' }, new Store());
assert.equal(await translator.translate('みなさんこんにちは'), 'Hello, everyone.');
await assert.rejects(translator.translate('失敗'), /429/);
console.log('PASS: real translation client → Postman simulation, success and rate-limit response');
