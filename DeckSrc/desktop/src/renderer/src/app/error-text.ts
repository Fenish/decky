/**
 * An error as a person should read it: without the "Error:" in front, or
 * the "Error invoking remote method '...':" Electron wraps main's errors in.
 */
export function errorText(error: unknown): string {
    return String(error).replace(
        /^(?:Error: )*(?:Error invoking remote method '[^']+': )?(?:Error: )*/,
        "",
    );
}
