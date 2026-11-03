import { normalizeFontFamily } from '../shared.js';

const TEXT_FALLBACK = 'var(--dsh-font-family-text-default, system-ui, sans-serif)';
const CODE_FALLBACK = 'var(--dsh-font-family-code-default, monospace)';
const TERMINAL_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function previewFamily(role, family) {
  const fallback = role === 'text' ? TEXT_FALLBACK : role === 'terminal' ? TERMINAL_FALLBACK : CODE_FALLBACK;
  const normalized = normalizeFontFamily(family);
  return normalized ? normalized + ', ' + fallback : fallback;
}

/** DSH 0.2.2-alpha.3 metrics, checked against the ui-theme ladder and the rendered Markdown CSS. */
export function previewMetrics(values) {
  const text = values.text.size;
  const code = values.code.size;
  const secondary = text <= 14 ? text - 1 : text - 2;
  return {
    body: text, bodyLeading: text + 10, userLeading: text + 8,
    h2: text + 5, h2Leading: text + 14, h3: text + 4, h3Leading: text + 12,
    secondary, tableLeading: secondary + 9, flowLeading: text + 10,
    code, codeLeading: code + 8, codeSmallLeading: code + 5,
    // Markdown's .875em!important overrides the nominal C+1 inline token.
    inlineCode: text * 0.875, terminal: values.terminal.size,
  };
}

/** Return only plugin-local variables; never modify Host theme tokens or the document. */
export function sceneStyle(values) {
  const metrics = previewMetrics(values);
  const style = {};
  for (const [key, value] of Object.entries(metrics)) style['--dfm-pv-' + key] = value + 'px';
  for (const role of ['text', 'code', 'terminal']) style['--dfm-pv-font-' + role] = previewFamily(role, values[role].family);
  return style;
}

/** Applied settings retain their actual sizes; an alternative changes only the selected family. */
export function referenceSettings(accepted, draft, role, family) {
  return family === '__current__' ? accepted : { ...draft, [role]: { ...draft[role], family } };
}

/** Small display-only tokenizer. Every token remains a React text node, never HTML. */
export function tokenizeCode(source) {
  const tokens = [];
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\b(?:const|let|return|true|false|export|function|new|async|await|null)\b|\b\d+(?:\.\d+)?\b)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ kind: 'plain', text: source.slice(cursor, match.index) });
    const value = match[0];
    const kind = value.startsWith('//') ? 'comment' : /^["']/.test(value) ? 'string' : /^\d/.test(value) ? 'number' : 'keyword';
    tokens.push({ kind, text: value });
    cursor = match.index + value.length;
  }
  if (cursor < source.length) tokens.push({ kind: 'plain', text: source.slice(cursor) });
  return tokens;
}

/** Read-only product scenes: no session data, message submission or terminal process. */
export function createSceneRenderer(React) {
  const h = React.createElement;
  const paths = {
    folder: 'M3 6h6l2 2h10v11H3z',
    chevron: 'm9 5 7 7-7 7',
    down: 'm6 9 6 6 6-6',
    check: 'm5 12 4 4 10-10',
    terminal: 'm4 6 6 6-6 6m9 0h7',
    copy: 'M9 8h11v13H9zM5 16H3V3h11v2',
    plus: 'M12 5v14M5 12h14',
    send: 'M12 19V5m-6 6 6-6 6 6',
    retry: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    more: 'M4 12h1m6 0h1m6 0h1',
    panel: 'M3 4h18v16H3zM15 4v16',
    quote: 'M7 7 4 12h3v5H2v-5l3-5zm9 0-3 5h3v5h-5v-5l3-5z',
  };
  function Icon({ name }) {
    return h('svg', { className: 'dfm-pv-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.more }));
  }
  const icon = name => h(Icon, { name });
  function CodeBlock({ content, t }) {
    return h('div', { className: 'dfm-pv-code-block' },
      h('div', { className: 'dfm-pv-code-header' }, h('span', null, 'TypeScript'), h('span', { className: 'dfm-pv-code-filename' }, t('pvCodeFile')), h('span', { className: 'dfm-pv-copy', 'aria-hidden': true }, icon('copy'), t('pvCopy'))),
      h('pre', null, h('code', null, ...tokenizeCode(content).map((token, index) => h('span', { key: index, className: 'dfm-pv-token-' + token.kind }, token.text)))));
  }
  function Composer({ t }) {
    return h('div', { className: 'dfm-pv-composer', 'aria-label': t('pvInputHint') },
      h('div', { className: 'dfm-pv-composer-draft' },
        h('span', { className: 'dfm-pv-quote-chip' }, icon('quote'), h('span', { className: 'dfm-pv-quote-text' }, t('pvQuoteChip'))),
        h('span', { className: 'dfm-pv-composer-text' }, t('pvComposer'))),
      h('div', { className: 'dfm-pv-composer-toolbar' }, h('span', { className: 'dfm-pv-composer-left' }, icon('plus'), h('span', null, t('pvModel')), icon('down'), h('span', { className: 'dfm-pv-permission' }, t('pvPermission'))), h('span', { className: 'dfm-pv-send', 'aria-hidden': true }, icon('send'))));
  }
  function MessageActions({ t }) {
    return h('div', { className: 'dfm-pv-message-actions', 'aria-label': t('pvActions') }, icon('copy'), icon('retry'), icon('more'));
  }
  function ToolResult({ t }) {
    return h('div', { className: 'dfm-pv-tool' },
      h('div', { className: 'dfm-pv-tool-title' }, icon('down'), icon('terminal'), h('strong', null, 'Bash'), h('span', null, t('pvToolTitle')), h('span', { className: 'dfm-pv-tool-check' }, icon('check'))),
      h('div', { className: 'dfm-pv-tool-summary' }, t('pvToolSummary')),
      h('div', { className: 'dfm-pv-tool-output' }, h('div', { className: 'dfm-pv-shell-command' }, h('span', { className: 'dfm-pv-shell-cwd' }, '~/font-demo'), h('span', null, '$ pnpm run check')), h('pre', null, ...t('pvToolOutput').split('\n').map((line, index) => h('span', { className: 'dfm-pv-output-line', key: index }, line || '\u00a0')))));
  }
  function Conversation({ scene, sample, t }) {
    return h('div', { className: 'dfm-pv-conversation' },
      h('div', { className: 'dfm-pv-user-row' }, h('div', { className: 'dfm-pv-user-bubble' }, t(scene === 'text' ? 'pvUserText' : 'pvUserCode'))),
      h('article', { className: 'dfm-pv-assistant' },
        h('div', { className: 'dfm-pv-thinking' }, icon('chevron'), t('pvThinking')),
        h('div', { className: 'dfm-pv-markdown' },
          h('h2', null, t(scene === 'text' ? 'pvHeading' : 'pvCodeHeading')),
          scene === 'text' ? h(React.Fragment, null,
            h('p', { className: 'dfm-pv-prose' }, sample || t('sampleBody')),
            h('p', null, h('strong', null, t('pvEmphasis')), t('pvInlineBefore'), h('code', null, 'fontFamily'), t('pvInlineAfter')),
            h('h3', null, t('pvSection')),
            h('ul', null, h('li', null, t('pvItemOne')), h('li', null, t('pvItemTwo'))),
            h('div', { className: 'dfm-pv-table-scroll' }, h('table', null,
              h('thead', null, h('tr', null, h('th', null, t('pvTableArea')), h('th', null, t('pvTableStatus')))),
              h('tbody', null, h('tr', null, h('td', null, t('pvTableRow1')), h('td', null, t('pvTableValue1'))), h('tr', null, h('td', null, t('pvTableRow2')), h('td', null, h('code', null, t('pvTableValue2'))))))),
            h('blockquote', null, t('pvQuote'))) : h(React.Fragment, null,
            h('p', null, t('pvCodeIntro')),
            h(CodeBlock, { content: sample || t('sampleCode'), t }),
            h(ToolResult, { t }),
            h('p', null, t('pvCodeAfter')))),
        h(MessageActions, { t })),
      h(Composer, { t }));
  }
  function Terminal({ sample, t }) {
    return h('div', { className: 'dfm-pv-terminal' },
      h('div', { className: 'dfm-pv-terminal-tabs' }, h('span', { className: 'dfm-pv-terminal-active' }, icon('terminal'), t('pvTerminalTab')), h('span', { className: 'dfm-pv-terminal-path' }, t('pvTerminalPath')), icon('plus'), icon('more')),
      h('div', { className: 'dfm-pv-terminal-screen' }, h('pre', null, sample || t('sampleTerminal'), h('span', { className: 'dfm-pv-cursor', 'aria-hidden': true }, ' '))),
      h('div', { className: 'dfm-pv-terminal-status' }, h('span', { className: 'dfm-pv-status-dot', 'aria-hidden': true }), t('pvTerminalFooter')));
  }
  return function DshScene({ scene, typography, sample, enlarge, t }) {
    return h('div', { className: 'dfm-pv-scroll' },
      h('section', { className: 'dfm-dsh-scene', style: { ...sceneStyle(typography), zoom: enlarge ? 1.5 : 1 }, 'data-scene': scene, 'aria-label': t('previewReadonly') },
        h('header', { className: 'dfm-pv-header' }, icon(scene === 'terminal' ? 'terminal' : 'folder'), h('span', { className: 'dfm-pv-header-title' }, t(scene === 'terminal' ? 'pvTerminalTitle' : 'pvConversation')), h('span', { className: 'dfm-pv-example-tag' }, t('pvDemo')), icon('panel')),
        scene === 'terminal' ? h(Terminal, { sample, t }) : h(Conversation, { scene, sample, t })));
  };
}
