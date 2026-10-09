import React, { useRef, useState } from 'react';
import { Menu } from '../feedback/Menu.jsx';
import { Button } from '../core/Button.jsx';
import { Icon } from '../core/Icon.jsx';
import { Skel, cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* DataTable (admin) — 02-components.md §24.
   Real table semantics: <caption> (required; visually hidden with hideCaption), <th scope="col">,
   aria-sort on sortable headers (sort buttons announce the new order), aria-selected rows.
   Cursor pagination only: onLoadMore + hasMore — no page numbers, no total count.
   Keyboard: rows are one roving tab stop — ArrowUp/Down move, Home/End jump, Enter activates the
   row (onRowActivate), Space toggles selection; Tab leaves the table. Row actions are a Menu
   button per row with a UNIQUE name ("Actions for order HG-10482").
   States: loading (5 skeleton rows in the real column geometry, header kept) · loadingMore (a
   skeleton row at the tail, loaded rows stay) · empty (header kept, says why + what next) ·
   empty-after-filter (distinct copy + "Clear filters") · error (header kept, Retry). */

export function DataTable({
  caption, hideCaption = false, columns = [], rows = [], getRowId = (r) => r.id,
  sort, onSortChange, selection, onSelectionChange, onRowActivate, rowActions, rowLabel,
  density = 'compact', stickyHeader = true, status = 'ready', errorMessage, onRetry,
  hasMore = false, loadingMore = false, onLoadMore, filtersActive = false, onClearFilters,
  emptyState, testId, style, ...rest
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const rowRefs = useRef([]);
  const [announce, setAnnounce] = useState('');
  const rowH = density === 'comfortable' ? 56 : 'var(--density-row-height)';
  const pad = density === 'compact' ? 'var(--space-3)' : 'var(--space-4)';
  const selectable = Array.isArray(selection) && typeof onSelectionChange === 'function';
  const hasActions = typeof rowActions === 'function';
  const colCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);
  const nameOf = (r) => (rowLabel ? rowLabel(r) : String(getRowId(r)));

  const toggle = (id) => {
    const next = selection.indexOf(id) >= 0 ? selection.filter((x) => x !== id) : selection.concat([id]);
    onSelectionChange(next);
    setAnnounce(next.length + (next.length === 1 ? ' row selected' : ' rows selected'));
  };
  const focusRow = (i) => { const n = Math.max(0, Math.min(rows.length - 1, i)); setFocusIdx(n); const el = rowRefs.current[n]; if (el) el.focus(); };
  const onRowKey = (e, r, i) => {
    if (e.target !== e.currentTarget) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); focusRow(i + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); focusRow(i - 1); }
    else if (k === 'Home') { e.preventDefault(); focusRow(0); }
    else if (k === 'End') { e.preventDefault(); focusRow(rows.length - 1); }
    else if (k === 'Enter' && onRowActivate) { e.preventDefault(); onRowActivate(r); }
    else if (k === ' ' && selectable) { e.preventDefault(); toggle(getRowId(r)); }
  };
  const sortBy = (c) => {
    const dir = sort && sort.key === c.key && sort.direction === 'ascending' ? 'descending' : 'ascending';
    onSortChange({ key: c.key, direction: dir });
    setAnnounce('Sorted by ' + c.label + ', ' + dir);
  };

  const cellBase = (c) => ({
    textAlign: c.align === 'end' ? 'end' : 'start', paddingInline: pad, whiteSpace: 'nowrap',
    fontSize: c.mono ? 'var(--type-mono-sm-size)' : 'var(--type-body-sm-size)',
    fontFamily: c.mono ? 'var(--font-mono)' : 'inherit',
    fontVariantNumeric: c.numeric || c.mono ? 'var(--numeric-tabular)' : 'normal',
    color: c.muted ? 'var(--text-tertiary)' : 'var(--text-primary)',
  });
  const skeletonRow = (key) => (
    <tr key={key} aria-hidden="true" style={{ blockSize: rowH, borderBlockEnd: '1px solid var(--border-decorative)' }}>
      {selectable ? <td style={{ paddingInline: pad }}><Skel w={18} h={18} /></td> : null}
      {columns.map((c) => <td key={c.key} style={{ paddingInline: pad }}><Skel w={c.mono ? '10ch' : c.numeric ? '6ch' : '70%'} h={12} style={{ marginInlineStart: c.align === 'end' ? 'auto' : 0 }} /></td>)}
      {hasActions ? <td /> : null}
    </tr>
  );
  const bodyMessage = (content) => (
    <tr><td colSpan={colCount} style={{ padding: 'var(--space-8) var(--space-4)', textAlign: 'center' }}>{content}</td></tr>
  );

  let body;
  if (status === 'loading') body = [0, 1, 2, 3, 4].map((i) => skeletonRow('s' + i));
  else if (status === 'error') body = bodyMessage(
    <div role="alert" style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--type-body-md-size)' }}>{errorMessage || 'Couldn’t load this list.'}</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--type-body-sm-size)' }}>Nothing has changed. Try again, or check your connection.</span>
      {onRetry ? <Button variant="tertiary" iconStart="refresh" onPress={onRetry}>Retry</Button> : null}
    </div>);
  else if (rows.length === 0 && filtersActive) body = bodyMessage(
    <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--type-body-md-size)', fontWeight: 'var(--font-weight-semibold)' }}>No results match these filters</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--type-body-sm-size)' }}>Records exist, but none match. Clear the filters to see everything.</span>
      {onClearFilters ? <Button variant="tertiary" onPress={onClearFilters}>Clear filters</Button> : null}
    </div>);
  else if (rows.length === 0) {
    const es = emptyState || {};
    body = bodyMessage(
      <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)' }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 'var(--type-body-md-size)', fontWeight: 'var(--font-weight-semibold)' }}>{es.title || 'Nothing to review yet'}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--type-body-sm-size)' }}>{es.description || 'New records appear here as soon as they arrive.'}</span>
        {es.action || null}
      </div>);
  } else {
    body = rows.map((r, i) => {
      const id = getRowId(r);
      const selected = selectable && selection.indexOf(id) >= 0;
      return (
        <tr key={id} ref={(el) => { rowRefs.current[i] = el; }} tabIndex={i === focusIdx ? 0 : -1}
          aria-selected={selectable ? selected : undefined}
          className="hg-row" data-interactive={onRowActivate ? '' : undefined} data-selected={selected ? '' : undefined}
          onFocus={(e) => { if (e.target === e.currentTarget) setFocusIdx(i); }}
          onClick={onRowActivate ? (e) => { if (!e.target.closest('button,input,a,[role="menu"]')) onRowActivate(r); } : undefined}
          onKeyDown={(e) => onRowKey(e, r, i)}
          style={{ blockSize: rowH, cursor: onRowActivate ? 'pointer' : undefined, borderBlockEnd: '1px solid var(--border-decorative)' }}>
          {selectable ? (
            <td style={{ paddingInline: pad, inlineSize: 44 }}>
              <label style={{ display: 'grid', placeItems: 'center', minInlineSize: 44, minBlockSize: 44, cursor: 'pointer' }}>
                <input type="checkbox" checked={selected} onChange={() => toggle(id)} aria-label={'Select ' + nameOf(r)}
                  className="hg-focus" style={{ inlineSize: 18, blockSize: 18, margin: 0, accentColor: 'var(--action-primary)' }} />
              </label>
            </td>
          ) : null}
          {columns.map((c) => <td key={c.key} style={cellBase(c)}>{c.render ? c.render(r) : r[c.key]}</td>)}
          {hasActions ? (
            <td style={{ paddingInline: 'var(--space-1)', inlineSize: 52, textAlign: 'end' }}>
              <Menu label={'Actions for ' + nameOf(r)} align="end" items={rowActions(r)} />
            </td>
          ) : null}
        </tr>
      );
    });
    if (loadingMore) body = body.concat([skeletonRow('more')]);
  }

  return (
    <div data-testid={testId || 'DataTable'} aria-busy={status === 'loading' || loadingMore || undefined} style={{
      background: 'var(--surface-raised)', border: '1px solid var(--border-decorative)', borderRadius: 'var(--radius-lg)', overflow: 'auto', ...style,
    }} {...rest}>
      <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)' }}>
        <caption className={hideCaption ? 'hg-sr' : undefined} style={hideCaption ? undefined : {
          captionSide: 'top', textAlign: 'start', padding: 'var(--space-3) ' + pad, fontSize: 'var(--type-label-lg-size)',
          fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-primary)', borderBlockEnd: '1px solid var(--border-decorative)',
        }}>{caption}</caption>
        <thead>
          <tr>
            {selectable ? <th scope="col" style={thStyle(pad, stickyHeader)}><span className="hg-sr">Selected</span></th> : null}
            {columns.map((c) => {
              const sorted = sort && sort.key === c.key ? sort.direction : undefined;
              return (
                <th key={c.key} scope="col" aria-sort={c.sortable ? (sorted || 'none') : undefined}
                  style={{ ...thStyle(pad, stickyHeader), textAlign: c.align === 'end' ? 'end' : 'start', inlineSize: c.width }}>
                  {c.sortable && onSortChange ? (
                    <button type="button" className="hg-focus hg-hit" onClick={() => sortBy(c)} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, minBlockSize: 32, padding: 0, border: 'none', background: 'transparent',
                      font: 'inherit', color: sorted ? 'var(--text-primary)' : 'inherit', cursor: 'pointer',
                    }}>
                      {c.label}
                      <span aria-hidden="true" style={{ display: 'inline-flex', transform: sorted === 'ascending' ? 'rotate(180deg)' : 'none', opacity: sorted ? 1 : 0.4 }}><Icon name="chevron-down" size={14} /></span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
            {hasActions ? <th scope="col" style={thStyle(pad, stickyHeader)}><span className="hg-sr">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      {status === 'ready' && rows.length > 0 && hasMore && onLoadMore ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-3)' }}>
          <Button variant="tertiary" size="sm" loading={loadingMore} onPress={onLoadMore}>Load more</Button>
        </div>
      ) : null}
      <span className="hg-sr" aria-live="polite" aria-atomic="true">{announce}</span>
    </div>
  );
}

function thStyle(pad, sticky) {
  return {
    position: sticky ? 'sticky' : undefined, insetBlockStart: sticky ? 0 : undefined, zIndex: sticky ? 1 : undefined,
    paddingBlock: 'var(--space-2)', paddingInline: pad, background: 'var(--surface-sunken)',
    borderBlockEnd: '1px solid var(--border-decorative)', fontSize: 'var(--type-label-sm-size)',
    letterSpacing: 'var(--type-label-sm-tracking)', fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-secondary)', whiteSpace: 'nowrap', textAlign: 'start',
  };
}
