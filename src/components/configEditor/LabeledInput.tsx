import React from 'react';
import { Input, InlineFormLabel } from '@grafana/ui';

interface LabeledInputProps {
  label: string;
  tooltip?: string;
  placeholder?: string;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}

export function LabeledInput(props: LabeledInputProps) {
  const { label, tooltip, placeholder, disabled, value, onChange, type } = props;

  return (
    <div className="gf-form">
      <InlineFormLabel width={12} className="query-keyword" tooltip={tooltip || label}>
        {label}
      </InlineFormLabel>
      <Input
        disabled={disabled}
        width={30}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        type={type}
      />
    </div>
  );
}
