declare module "pdf-parse/lib/pdf-parse.js" {
  const pdf: (data: Buffer, opts?: any) => Promise<{ text: string; numpages: number }>;
  export default pdf;
}
