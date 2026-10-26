/** The Read's body as paragraphs. */
export const paragraphs = (body: string): string[] => body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
