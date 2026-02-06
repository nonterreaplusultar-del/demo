// ES Module 版本，批量修复 blog/talks 文章 frontmatter

import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import { dirname } from "path";

// 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 修改为你的 blog 目录
const BLOG_DIR = path.join(__dirname, "blog");


/**
 * 批量处理 Markdown 文件
 */
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

      // --- type ---
      // 自动修正为 "talk"（保证 schema 一致）
      data.type = "talk";

      // --- tags ---
      if (data.tags) {
        if (typeof data.tags === "string") data.tags = [data.tags];
      } else {
        data.tags = [];
      }

      // --- categories ---
      // schema 要求 string
      if (!data.categories) data.categories = "talks";
      else if (Array.isArray(data.categories)) data.categories = data.categories[0];

      // --- date ---
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

      // --- id ---
      if (!data.id) data.id = path.basename(file, path.extname(file));

      // 写回文件
      const newContent = matter.stringify(parsed.content, data);
      await fs.writeFile(filePath, newContent, "utf-8");

      console.log(`✅ 已处理: ${file}`);
    }
  }
}

// 执行
processFiles(BLOG_DIR)
  .then(() => console.log("🎉 所有文章处理完成！"))
  .catch((err) => console.error(err));
