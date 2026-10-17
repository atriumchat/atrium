import { useId, useState } from 'react';
import { InputOTP, Input, Label, REGEXP_ONLY_DIGITS_AND_CHARS, TextField } from '@heroui/react';

/** A new recovery key is XXXX-XXXX-XXXX-XXXX; the dashes aren't typed. */
const ROWS = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [8, 9, 10, 11, 12, 13, 14, 15],
];
const KEY_LENGTH = ROWS.flat().length;

/**
 * The recovery key in boxes, two rows of two groups. Pasting takes the key with dashes and spaces. Keys made before
 * had 32 characters and don't fit the boxes, so "Старый ключ" swaps them for a plain field.
 */
export function RecoveryKeyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [old, setOld] = useState(false);

  const toggle = (
    <button
      type="button"
      onClick={() => {
        setOld(!old);
        onChange('');
      }}
      className="self-start text-[13px] text-muted hover:text-foreground hover:underline"
    >
      {old ? 'Новый ключ' : 'Старый ключ'}
    </button>
  );

  if (old) {
    return (
      <div className="flex flex-col gap-2">
        <TextField isRequired fullWidth value={value} onChange={onChange} maxLength={64} autoComplete="off">
          <Label>Ключ восстановления</Label>
          <Input className="h-11 bg-default font-mono text-[15px]" placeholder="XXXX-XXXX-…" />
        </TextField>
        {toggle}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Ключ восстановления</Label>
      <InputOTP
        id={id}
        value={value}
        onChange={(v) => onChange(v.toUpperCase())}
        maxLength={KEY_LENGTH}
        minLength={KEY_LENGTH}
        required
        pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
        pasteTransformer={(pasted) => pasted.replace(/[^a-zA-Z0-9]/g, '')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        variant="secondary"
        className="flex-col items-stretch"
      >
        {ROWS.map((row) => (
          <div key={row[0]} className="flex items-center gap-2">
            <InputOTP.Group className="flex-1">
              {row.slice(0, 4).map((i) => (
                <InputOTP.Slot key={i} index={i} />
              ))}
            </InputOTP.Group>
            <InputOTP.Separator />
            <InputOTP.Group className="flex-1">
              {row.slice(4).map((i) => (
                <InputOTP.Slot key={i} index={i} />
              ))}
            </InputOTP.Group>
          </div>
        ))}
      </InputOTP>
      {toggle}
    </div>
  );
}
