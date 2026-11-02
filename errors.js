export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const asyncRoute = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function parsePage(value) {
  const page = Number.parseInt(value ?? '1', 10);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    throw new HttpError(400, 'page debe ser un entero entre 1 y 500', 'INVALID_PAGE');
  }
  return page;
}

export function parseId(value) {
  if (!/^\d{1,12}$/.test(String(value))) {
    throw new HttpError(400, 'Identificador inválido', 'INVALID_ID');
  }
  return String(value);
}

export function parsePositiveInt(value, name) {
  if (value == null) return null;
  if (!/^\d{1,4}$/.test(String(value)) || Number(value) < 1) {
    throw new HttpError(400, `${name} debe ser un entero positivo`, `INVALID_${name.toUpperCase()}`);
  }
  return Number(value);
}