import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type { FormSchema } from "@/types/strategy";

/** 使用项目 Form 的 JSON Schema，控件全部复用 shadcn。 */
export default function SchemaFields({ schema, values, onChange, root = schema, prefix = "form" }: {
  schema: FormSchema; values: Record<string, unknown>; onChange: (values: Record<string, unknown>) => void;
  root?: FormSchema; prefix?: string;
}) {
  const resolve = (field: FormSchema): FormSchema => field.$ref
    ? { ...root.$defs?.[field.$ref.split("/").pop()!], ...field, $ref: undefined } : field;
  return <div className="grid min-w-0 gap-5 sm:grid-cols-2">
    {Object.entries(schema.properties ?? {}).map(([name, original]) => {
      let field = resolve(original);
      const nullable = field.anyOf?.some((option) => option.type === "null");
      if (field.anyOf) field = { ...resolve(field.anyOf.find((option) => option.type !== "null") ?? {}), ...field, anyOf: undefined };
      const id = `${prefix}-${name}`;
      const value = values[name];
      const change = (next: unknown) => onChange({ ...values, [name]: next });
      const choices = field.enum ?? (field.const !== undefined ? [field.const] : undefined);
      const required = schema.required?.includes(name);
      if (field.type === "object") return <fieldset className="col-span-full min-w-0 space-y-4 rounded-md border p-4" key={id}>
        <legend className="px-1 text-sm font-medium">{field.title ?? name}</legend>
        <SchemaFields schema={field} root={root} prefix={id} values={(value ?? {}) as Record<string, unknown>} onChange={change} />
      </fieldset>;
      return <div className="min-w-0 space-y-2" key={id}>
        <Label htmlFor={id}>{field.title ?? name}{required && <span className="text-destructive">*</span>}</Label>
        {choices ? <Select value={value == null ? "" : String(value)} onValueChange={(item) => change(choices.find((choice) => String(choice) === item))}>
          <SelectTrigger id={id} className="w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
          <SelectContent>{choices.map((item, index) => <SelectItem key={String(item)} value={String(item)}>{field["x-enum-labels"]?.[index] ?? String(item)}</SelectItem>)}</SelectContent>
        </Select> : field.type === "boolean" ? <div className="flex h-9 items-center"><Switch id={id} checked={Boolean(value)} onCheckedChange={change} /></div>
          : <Input id={id} className="w-full" required={required} type={field.format === "date" ? "date" : field.type === "integer" || field.type === "number" ? "number" : "text"}
            step={field.type === "integer" ? 1 : "any"} min={field.minimum ?? (field.type === "integer" && field.exclusiveMinimum !== undefined ? field.exclusiveMinimum + 1 : undefined)} max={field.maximum}
            value={Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value)}
            placeholder={field.type === "array" ? "多个值用逗号分隔" : field.format === "duration" ? "例如 P60D（60 天）" : undefined}
            onChange={(event) => {
              const text = event.target.value;
              if (!text) { change(nullable ? null : ""); return; }
              change(field.type === "integer" || field.type === "number" ? Number(text) : field.type === "array"
                ? text.split(/[,，]/).map((item) => field.items?.type === "number" || field.items?.type === "integer" ? Number(item.trim()) : item.trim()) : text);
            }} />}
      </div>;
    })}
  </div>;
}
