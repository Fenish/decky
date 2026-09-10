export interface InstalledProgram {
    name: string;
    path: string;
    source: "start-menu" | "registered" | "windows";
}
export function validProgramTarget(value: unknown): value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 2048 ||
        Array.from(value).some((c) => c.charCodeAt(0) < 32)
    )
        return false;
    if (value.startsWith("app:")) return /^[A-Za-z0-9_.!{}\\ -]{1,1024}$/.test(value.slice(4));
    return /^(?:[a-z]:[\\/]|\\\\[^\\]+\\|\/)/i.test(value) && /\.(exe|lnk)$/i.test(value);
}
export function programDisplayName(path: string): string {
    return path.startsWith("app:")
        ? path.slice(4)
        : (path
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.(exe|lnk)$/i, "") ?? "");
}
export function matchPrograms(programs: InstalledProgram[], query: string): InstalledProgram[] {
    const text = query.trim().toLocaleLowerCase();
    const terms = text.split(/\s+/).filter(Boolean);
    return programs
        .filter((program) => {
            const haystack =
                `${program.name} ${programDisplayName(program.path)}`.toLocaleLowerCase();
            return terms.every((term) => haystack.includes(term));
        })
        .sort((a, b) => {
            const rank = (name: string): number =>
                name.toLocaleLowerCase() === text
                    ? 0
                    : name.toLocaleLowerCase().startsWith(text)
                      ? 1
                      : 2;
            return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
        });
}
