import { version } from '@/package.json';

export const webRelease = `${version}-${process.env.MAHA_WEB_BUILD_LABEL || 'development'}`;
