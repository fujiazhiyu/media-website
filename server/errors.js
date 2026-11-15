export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function publicError(error) {
  if (error instanceof HttpError) return error;
  if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new HttpError(404, '文件或目录不存在，可能已被移动。');
  if (['EACCES', 'EPERM'].includes(error.code)) return new HttpError(403, '没有读取权限，请检查服务账户的目录权限。');
  return new HttpError(500, '读取失败，请稍后重试并查看服务日志。');
}
