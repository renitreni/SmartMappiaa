import { useRef } from 'react';

/**
 * Controlled 4-digit code input.
 * Props:
 *  - value: string[] length 4 (e.g. ['', '', '', ''])
 *  - onChange: (nextValue: string[]) => void
 *  - length: number of boxes (default 4, matches the mockup)
 */
export default function OtpInput({ value, onChange, length = 4 }) {
  const inputRefs = useRef([]);

  const handleChange = (index, rawValue) => {
    const digit = rawValue.replace(/[^0-9]/g, '').slice(-1);
    const next = [...value];
    next[index] = digit;
    onChange(next);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="auth-otp-row">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => (inputRefs.current[index] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          className="auth-otp-box"
          value={value[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          autoFocus={index === 0}
        />
      ))}
    </div>
  );
}
