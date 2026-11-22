import test from 'node:test';
import assert from 'node:assert/strict';
import { readPickerState, resolveInheritedLabel } from '../agy-capsule/sidecars/agy_capsule/model_picker.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';

function host(id) {
  const current = { label: 'First (Low)' };
  const target = { label: 'Second (High)' };
  const calls = [];
  const provider = {
    visibleModelConfigs: [current, target, { label: 'Disabled', disabled: true }, target],
    getModelConfigForConversation: () => current,
    setModelConfigByLabelForConversation(...args) { calls.push(args); },
  };
  const root = { memoizedProps: { value: provider } };
  const leaf = { memoizedProps: { conversationId: id, placement: 'top' }, return: root };
  return { leaf, root, provider, calls };
}

test('optional picker sends one exact option to the conversation and reads host state independently', () => {
  assert.equal(DEFAULT_SETTINGS.modelEffortPicker, false);
  const fixture = host('example-a');
  const trigger = { __reactFiber$test: fixture.leaf };
  const state = readPickerState(trigger);
  assert.deepEqual(state.labels, ['First (Low)', 'Second (High)']);
  state.choose('Second (High)');
  assert.deepEqual(fixture.calls, [['Second (High)', 'example-a', false]]);
  assert.equal(readPickerState(trigger).selected, 'First (Low)');
});

test('uses the committed tree after React switches branches', () => {
  const stale = host('example-a'), live = host('example-b');
  stale.leaf.alternate = live.leaf;
  stale.root.stateNode = { current: live.root };
  assert.equal(readPickerState({ __reactFiber$test: stale.leaf }).conversationId, 'example-b');
});

function selectorHost(id) {
  const current = { label: 'Gemini 4 Neon (High)', value: 1532, disabled: false };
  const target = { label: 'Gemini 4 Argon (High)', value: 1419, disabled: false };
  const disabled = { label: 'Gemini 4 Carbon', value: 1670, disabled: true };
  const calls = [];
  const contextValue = {
    selectedModel: current,
    modelOptions: [current, target, disabled, target],
    setSelectedModel(option) { calls.push(option); },
  };
  const owner = { memoizedProps: { conversationId: id, placement: 'top-start' } };
  const leaf = { memoizedProps: { value: contextValue }, return: owner };
  return { leaf, owner, contextValue, current, target, calls };
}

test('2.33.0 selector context passes the exact host option object and ignores disabled options', () => {
  const fixture = selectorHost('conv-233');
  const trigger = { __reactFiber$test: fixture.leaf };
  const state = readPickerState(trigger);
  assert.equal(state.conversationId, 'conv-233');
  assert.equal(state.selected, 'Gemini 4 Neon (High)');
  assert.deepEqual(state.labels, ['Gemini 4 Neon (High)', 'Gemini 4 Argon (High)']);
  state.choose('Gemini 4 Argon (High)');
  assert.deepEqual(fixture.calls, [fixture.target]);
  const newChat = readPickerState({ __reactFiber$test: selectorHost(undefined).leaf });
  assert.equal(newChat.conversationId, '__new__');
  assert.equal(newChat.selected, 'Gemini 4 Neon (High)');
});

test('merged Orchestrator selects a planner separately, even when it shares a standalone model', () => {
  const { leaf, owner, contextValue, current, target, calls } = selectorHost('conv-orchestrator');
  current.modelId = 'gemini-4-neon-high';
  target.modelId = 'gemini-4-argon-high';
  const neon = { label: 'Orchestrator (Neon)', value: 1537, modelId: 'gemini-pro-orchestrator-neon', tagTitle: 'New' };
  const argon = { label: 'Orchestrator (Argon)', value: 1668, modelId: 'gemini-pro-orchestrator-g1-pro' };
  const neonLow = { label: 'Gemini 4 Neon (Low)', value: 1534 };
  const disabled = { label: 'Gemini 4 Neon (XHigh)', value: 1535, disabled: true };
  const picks = [];
  const pick = { model: 0, select: value => picks.push(value) };
  Object.assign(contextValue, {
    modelOptions: [current, neonLow, { ...disabled, disabled: false }, neon, argon, target],
    groups: [{ options: [current, neon, target] }],
    orchestratorPlanners: [current, neonLow, disabled, target],
    orchestratorDefaultPlanner: current,
    orchestratorPick: pick,
  });
  owner.return = { memoizedProps: { value: {
    onDidChange() {},
    getState: () => ({ getPrefValue: key => key === 'orchestratorModel' ? neonLow.value : undefined }),
  } } };
  const read = () => readPickerState({ __reactFiber$test: leaf });
  const state = read();
  assert.deepEqual(state.families, ['Gemini 4 Neon', 'Orchestrator', target.label]);
  assert.deepEqual(state.orchestrator.planners.map(group => group.name), ['Gemini 4 Neon', 'Gemini 4 Argon']);
  assert.deepEqual(state.orchestrator.planners[0].items.map(item => item.tier), ['High', 'Low']);
  assert.equal(state.orchestrator.active, false);
  assert.equal(state.orchestrator.current, 'Orchestrator → Gemini 4 Neon (Low)');
  assert.equal(state.orchestrator.targets[current.label], 'Orchestrator → ' + current.label);
  assert.equal(state.orchestrator.targets[disabled.label], undefined, 'a tier available standalone may not be available to Orchestrator');
  state.choose(target.label);
  state.choose('Orchestrator → Gemini 4 Neon (XHigh)');
  state.choose('Orchestrator → ' + target.label);
  assert.deepEqual(calls, [target, neon]);
  assert.deepEqual(picks, [target.value]);

  contextValue.selectedModel = argon;
  pick.model = target.value;
  const active = read();
  assert.equal(active.selected, 'Orchestrator → ' + target.label);
  assert.equal(active.orchestrator.standalone, target.label);
  active.choose('Orchestrator → ' + neonLow.label);
  assert.equal(picks.at(-1), 0, 'the configured default clears the conversation override');
  assert.equal(calls.at(-1), argon, 'keep the active Orchestrator model rather than selecting the planner standalone');
});

test('missing conversation, selector, or matching selection leaves control to the native picker', () => {
  assert.equal(readPickerState({}), null);
  assert.equal(readPickerState({ __reactFiber$test: host(null).leaf }), null);
  const fixture = host('example');
  fixture.leaf.memoizedProps.modelOptions = [];
  assert.equal(readPickerState({ __reactFiber$test: fixture.leaf }), null);
});

test('direct-click effort inheritance follows current tier and downgrades XHigh/Extra to High', () => {
  const argon = [
    { label: 'Gemini 4 Argon (Low)', tier: 'Low' },
    { label: 'Gemini 4 Argon (Medium)', tier: 'Medium' },
    { label: 'Gemini 4 Argon (High)', tier: 'High' },
  ];
  const hydrogen = [
    ...argon.map(x => ({ label: x.label.replace('Argon', 'Hydrogen'), tier: x.tier })),
    { label: 'Gemini 4 Hydrogen (XHigh)', tier: 'XHigh' },
  ];
  assert.equal(resolveInheritedLabel(argon, 'Gemini 4 Neon (Medium)'), 'Gemini 4 Argon (Medium)');
  assert.equal(resolveInheritedLabel(argon, 'Gemini 4 Neon (Low)'), 'Gemini 4 Argon (Low)');
  assert.equal(resolveInheritedLabel(argon, 'Gemini 4 Neon (XHigh)'), 'Gemini 4 Argon (High)');
  assert.equal(resolveInheritedLabel(argon, 'Gemini 4 Neon (Extra)'), 'Gemini 4 Argon (High)');
  assert.equal(resolveInheritedLabel(hydrogen, 'Gemini 4 Neon (XHigh)'), 'Gemini 4 Hydrogen (XHigh)');
  assert.equal(resolveInheritedLabel(argon, 'Orchestrator (Neon)'), 'Gemini 4 Argon (High)');
  assert.equal(resolveInheritedLabel(argon, 'Gemini 4 Argon (Low)'), 'Gemini 4 Argon (Low)');
});

test('hideModelTags, hideDefaultEffort, customizeModelList and hiddenModels settings validate and normalize cleanly', () => {
  assert.equal(DEFAULT_SETTINGS.hideModelTags, false);
  assert.equal(DEFAULT_SETTINGS.hideDefaultEffort, false);
  assert.equal(DEFAULT_SETTINGS.customizeModelList, false);
  assert.deepEqual(DEFAULT_SETTINGS.hiddenModels, []);
  const normalized = normalizeSettings({
    modelEffortPicker: true,
    hideModelTags: true,
    hideDefaultEffort: true,
    customizeModelList: true,
    hiddenModels: ['Gemini 3.8 Flash', ' ', 'Gemini 3.8 Flash', 42, 'GPT-OSS 120B (Medium)'],
  });
  assert.equal(normalized.hideModelTags, true);
  assert.equal(normalized.hideDefaultEffort, true);
  assert.equal(normalized.customizeModelList, true);
  assert.deepEqual(normalized.hiddenModels, ['Gemini 3.8 Flash', 'GPT-OSS 120B (Medium)']);
});

test('model picker settings keep a unified row preview and compact model names', () => {
  assert.match(UI_HTML, /data-hide-model-tags=/);
  assert.match(UI_HTML, /data-hide-default-effort=/);
  assert.match(UI_HTML, /class="pv-mp-row"/);
  assert.match(UI_HTML, /class="pv-mp-row-effort"/);
  assert.match(UI_HTML, /class="pv-mp-row-tag"/);
  assert.match(UI_HTML, /\.pv-model-list\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap;/);
  assert.match(UI_HTML, /function formatModelListName\(name\)/);
  assert.match(UI_HTML, /\(\?:Gemini\|Claude\)\\s\+/);
});
