import { ValidationError } from 'class-validator';

export function formatValidationErrors(errors: ValidationError[]) {
  const result: Record<string, string> = {};

  const walk = (errs: ValidationError[], path = '') => {
    for (const err of errs) {
      const currentPath = path ? `${path}.${err.property}` : err.property;

      if (err.constraints) {
        result[currentPath] = Object.values(err.constraints)[0];
      }

      if (err.children?.length) {
        walk(err.children, currentPath);
      }
    }
  };

  walk(errors);
  return result;
}
