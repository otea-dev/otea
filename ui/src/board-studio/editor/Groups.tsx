import type { Group, Step } from '../../../../src/core/board/model.ts';
import { t } from '../../i18n/i18n.ts';
import { ChipButton } from '../../kit/Button.tsx';
import { useEditor } from './context.ts';
import {
  addGroup,
  groupable,
  removeGroup,
  renameGroup,
  setGroupMin,
  toggleGroupPart,
} from './edits.ts';
import { Glyph } from './glyphs.tsx';
import { Conseq } from './SentenceText.tsx';

// «Al menos N de»: groups of the step's optional evidence the agent picks from (Step.groups). Each
// one says how many it needs, and which of what the step hands off may fill it.
function GroupRow({ step, group }: { step: Step; group: Group }) {
  const { draft } = useEditor();
  const def = draft.def;
  const choices = groupable(def, step);
  const mutate = (change: (d: typeof def) => void, burst?: string) => draft.mutate(change, burst);
  return (
    <div className="se-group" data-group={group.id}>
      <div className="se-group-head">
        <label className="se-fld se-group-name">
          <span className="se-flab">{t('bs.editor.group.name')}</span>
          <input
            className="se-tx"
            value={group.name}
            maxLength={32}
            onChange={(e) =>
              mutate((d) => renameGroup(d, step.id, group.id, e.target.value), `group:${group.id}`)
            }
            onBlur={() => draft.endBurst()}
          />
        </label>
        <label className="se-fld se-group-min">
          <span className="se-flab">{t('bs.editor.group.min')}</span>
          <select
            className="se-tx"
            value={group.min}
            onChange={(e) =>
              mutate((d) => setGroupMin(d, step.id, group.id, Number(e.target.value)))
            }
          >
            {group.parts.map((ref, index) => (
              <option key={ref} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="se-x"
          aria-label={t('bs.editor.group.remove')}
          title={t('bs.editor.group.remove')}
          onClick={() => mutate((d) => removeGroup(d, step.id, group.id))}
        >
          <Glyph name="x" />
        </button>
      </div>
      <div className="se-group-from">
        <span className="se-flab">{t('bs.editor.group.from')}</span>
        <div className="se-radios">
          {choices.map((ref) => (
            <ChipButton
              key={ref}
              on={group.parts.includes(ref)}
              onClick={() => mutate((d) => toggleGroupPart(d, step.id, group.id, ref))}
            >
              {def.parts[ref]?.name ?? ref}
            </ChipButton>
          ))}
        </div>
      </div>
      <Conseq s={{ key: 'bs.editor.group.conseq', params: { min: group.min } }} />
    </div>
  );
}

export function GroupRows({ step }: { step: Step }) {
  const { draft } = useEditor();
  const def = draft.def;
  const choices = groupable(def, step);
  const groups = step.groups ?? [];
  if (choices.length < 2 && groups.length === 0) return null;
  return (
    <>
      {groups.map((group) => (
        <GroupRow key={group.id} step={step} group={group} />
      ))}
      {choices.length >= 2 ? (
        <div className="se-addrow">
          <button
            type="button"
            className="se-addbtn"
            onClick={() =>
              draft.mutate((d) => {
                addGroup(d, step.id, t('bs.editor.group.default_name'));
              })
            }
          >
            <Glyph name="plus" />
            {t('bs.editor.group.add')}
          </button>
        </div>
      ) : null}
    </>
  );
}
