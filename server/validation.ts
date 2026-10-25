import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { HttpError } from './errors.js';

export async function validateDto<T extends object>(
  dtoType: ClassConstructor<T>,
  input: unknown,
): Promise<T> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'O corpo da requisição deve ser um objeto.');
  }

  const dto = plainToInstance(dtoType, input);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new HttpError(400, messages.join(' ') || 'Dados inválidos.');
  }

  return dto;
}
