import { describe, expect, it } from 'vitest';
import { pinProblem } from './pin-policy';

describe('pinProblem', () => {
  it.each(['0000', '1111', '999999', '1234', '123456', '4321', '98765'])('rejects easy PIN %s', (pin) => {
    expect(pinProblem(pin)).not.toBeNull();
  });

  it.each(['12a4', '123', '1234567', ''])('rejects malformed PIN "%s"', (pin) => {
    expect(pinProblem(pin)).not.toBeNull();
  });

  it.each(['2580', '9148', '30715', '482913'])('accepts %s', (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });
});
