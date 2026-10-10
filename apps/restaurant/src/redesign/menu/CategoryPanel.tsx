/**
 * Add a category (`?panel=category`; MH `MenuCreateCategory`, -Saving, -Created, -Failed, -Taken,
 * spec §5). In-page task panel, never an overlay. The Idempotency-Key is minted when the panel
 * opens and reused on every retry of this one category.
 */
import { useRef, useState } from 'react';
import { idempotencyKey, type Schema } from '@hg/api-client';
import { Banner, Button, DetailPanel, Input, Textarea } from '../ds';
import { errorCode } from '../data/useServerResource';
import { createCategory } from './api';

export interface CategoryPanelProps {
  onClose: () => void;
  onCreated: (category: Schema['MenuCategory']) => void;
  /** 403 MENU_LOCKED: the page goes read-only. */
  onLocked: () => void;
}

export function CategoryPanel({ onClose, onCreated, onLocked }: CategoryPanelProps) {
  const key = useRef(idempotencyKey());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMissing(true);
      return;
    }
    setSaving(true);
    setMissing(false);
    setTakenName(null);
    try {
      const created = await createCategory(key.current, {
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated(created);
    } catch (error) {
      const code = errorCode(error);
      setSaving(false);
      if (code === 'CATEGORY_NAME_TAKEN') {
        setTakenName(trimmed);
        // A new name is a new intent.
        key.current = idempotencyKey();
        setFailedFor(null);
      } else if (code === 'MENU_LOCKED') {
        onLocked();
      } else {
        setFailedFor(trimmed);
      }
    }
  };

  return (
    <DetailPanel
      as="section"
      id="cat-panel"
      headingId="cat-panel-h"
      width="task"
      title="Add a category"
      label="Add a category"
      closeLabel="Close Add a category"
      closeDisabled={saving}
      onClose={onClose}
      busy={saving}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" disabled={saving} onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onPress={() => void submit()}>
            {saving ? 'Adding…' : failedFor ? 'Try again' : 'Add category'}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) void submit();
        }}
      >
        <p className="text-[15px] text-fg-secondary">
          Categories group items on your menu. They need no review. Customers see a category once it has an approved item.
        </p>
        {failedFor ? (
          <Banner
            variant="danger"
            title={`We couldn’t add ${failedFor}.`}
            description="Check your connection and try again. What you typed is still here."
          />
        ) : null}
        <Input
          id="cat-name"
          label="Category name"
          required
          maxLength={60}
          characterCount
          value={name}
          onChange={(v) => {
            setName(v);
            setTakenName(null);
            setMissing(false);
          }}
          readOnly={saving}
          helperText="For example Mains, Wraps or Drinks. Up to 40 categories."
          errorText={
            takenName
              ? `You already have a category called ${takenName}. Choose another name.`
              : missing
                ? 'Enter a category name.'
                : undefined
          }
        />
        <Textarea
          id="cat-description"
          label="Description (optional)"
          helperText="Shown under the category name on your menu."
          rows={3}
          maxLength={500}
          characterCount
          value={description}
          onChange={(v) => setDescription(v)}
          readOnly={saving}
        />
      </form>
    </DetailPanel>
  );
}
