/**
 * Quotes one argument for a command that runs through the Windows shell. Node joins the arguments
 * of a shell command with spaces and no quoting, so a path containing a space would be split apart.
 * Off Windows nothing runs through a shell, and the value is passed through unchanged.
 */
export function shellArgument(value) {
  return process.platform === 'win32' ? `"${value}"` : value;
}
