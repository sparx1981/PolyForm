import type { User } from 'firebase/auth';
export const CMS_ADMIN_EMAIL = 'craigtrickett@gmail.com';
export function isCmsAdmin(user: Pick<User, 'email' | 'emailVerified'> | null) { return !!user?.emailVerified && user.email?.toLowerCase() === CMS_ADMIN_EMAIL; }
