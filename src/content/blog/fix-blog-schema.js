import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";

// 获取当前目录路径（ESM 不支持 __dirname）
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BLOG_DIR = path.join(__dirname, "../blog"); // 调整到你的 blog 文件夹

async function processFiles(dir) {
  const files = await fs.readdir(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      await processFiles(filePath);
    } else if (file.endsWith(".md") || file.endsWith(".mdx")) {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = matter(content);
      const data = parsed.data;

      // tags
      if (data.tags) {
        if (typeof data.tags === "string") data.tags = [data.tags];
      } else {
        data.tags = [];
      }

      // categories
      if (!data.categories) data.categories = ["talks"];
      else if (typeof data.categories === "string") data.categories = [data.categories];

      // date
      if (data.date) {
        const d = new Date(data.date);
        if (!isNaN(d)) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          data.date = `${yyyy}-${mm}-${dd}`;
        } else {
          data.date = new Date().toISOString().slice(0, 10);
        }
      } else {
        data.date = new Date().toISOString().slice(0, 10);
      }

      // id
      if (!data.id) data.id = path.basename(file, path.extname(file));

      const newContent = matter.stringify(parsed.content, data);
      await fs.writeFile(filePath, newContent, "utf-8");

      console.log(`✅ 已处理: ${file}`);
    }
  }
}

processFiles(BLOG_DIR)
  .then(() => console.log("🎉 所有文章处理完成！"))
  .catch((err) => console.error(err));
