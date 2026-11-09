/**
 * 比较已经通过 realpath 规范化的本地音乐目录，兼容盘符根目录与 Windows 大小写规则。
 * 此处只做词法范围判断，不解析符号链接；服务器路径继续使用各自的 POSIX 校验。
 */
import path from "node:path"

/**
 * 判断文件或子目录是否位于指定根目录，用于导入时消除重复和父子目录重叠。
 * 通过相对路径识别越界与不同盘符，不依赖给根目录再次拼接分隔符；测试可注入 win32 路径实现。
 */
export function containsLocalPath(root, filename, paths = path) {
  const relative = paths.relative(root, filename)
  return relative === "" || (!paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + paths.sep))
}
