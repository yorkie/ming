import { strict as assert } from 'node:assert';
import { defaultGlobalSettings, parseGlobalSettings } from '../src/lib/globalSettings';

assert.deepEqual(parseGlobalSettings(null), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"codeFontSize":15,"codeLineHeight":28}'), { ...defaultGlobalSettings, codeFontSize: 15, codeLineHeight: 28 });
assert.deepEqual(parseGlobalSettings('{"codeFontSize":100,"codeLineHeight":12}'), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('{"showLineNumbers":false,"defaultReviewTab":"commits","copilotProvider":"custom","copilotRole":"security"}'), {
  ...defaultGlobalSettings, showLineNumbers: false, defaultReviewTab: 'commits', copilotProvider: 'custom', copilotRole: 'security',
});
assert.deepEqual(parseGlobalSettings('{"showReadmePreview":"false","defaultReviewTab":"unknown","copilotModel":42}'), defaultGlobalSettings);
assert.deepEqual(parseGlobalSettings('invalid'), defaultGlobalSettings);
console.log('Global settings test passed');
