import { z } from 'zod';
import { ROLES, STATIONS } from '../domain/enums';

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof errorSchema>;

/** Error responses every route may return. */
export const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  423: errorSchema,
  429: errorSchema,
} as const;

/** Money / quantity travel as strings to keep exact decimals across JSON. */
export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Số không hợp lệ');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');
export const reason = z.string().trim().min(5, 'Lý do tối thiểu 5 ký tự');

export const roleSchema = z.enum(ROLES);
export const stationSchema = z.enum(STATIONS);

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  fullName: z.string(),
  role: roleSchema,
  station: stationSchema.nullable(),
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
  active: z.boolean(),
});
export type UserDto = z.infer<typeof userSchema>;

/** Route metadata read by the auth middleware. `roles` omitted = any signed-in user; `public` = no auth. */
export type RouteMeta = { roles?: readonly (typeof ROLES)[number][]; public?: boolean };
