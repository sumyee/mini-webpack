const path = require('path');
const fs = require('fs');
const { parse } = require('@babel/parser');
// babylon 把源码转换成 AST
const babylon = require('babylon');
// @babel/traverse 遍历和更新生成的AST
const traverse = require('@babel/traverse').default;
// @babel/types 用于 AST 的类,其封装了大量与 AST 有关的方法
const t = require('@babel/types');
// @babel/generator
const generator = require('@babel/generator').default;

const ejs = require('ejs');

const tapable = require('tapable');

class Compiler {
  constructor(config) {
    // 缓存模块 解决循环引用
    this.cachedModule = {};
    // 获取到 config
    this.config = config;

    // 保存入口文件的路径
    this.entryId;

    // 保存所有模块依赖
    this.modules = {};

    // 入口路径
    this.entry = config.entry;

    // 工作路径
    this.root = process.cwd();

    // hooks
    this.hooks = {
      entryOption: new tapable.SyncHook(),
      compile: new tapable.SyncHook(),
      afterCompile: new tapable.SyncHook(),
      afterplugins: new tapable.SyncHook(),
      run: new tapable.SyncHook(),
      emit: new tapable.SyncHook(),
      done: new tapable.SyncHook(),
    };

    // 如果配置了 plugins
    const plugins = this.config.plugins;
    if (Array.isArray(plugins)) {
      plugins.forEach((plugin) => {
        plugin.apply(this);
      });
    }

    this.hooks.afterplugins.call();
  }

  getSource(path) {
    let content = fs.readFileSync(path, 'utf8');

    // 处理 loader
    const rules = this.config.modules ? this.config.modules.rules : [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const { test, use } = rule;
      const len = use.length - 1;

      if (test.test(modulePath)) {
        // 获取对应 loader
        function normalLoader() {
          const loader = require(use[len--]);
          content = loader(content);
          if (len >= 0) {
            normalLoader();
          }
        }
        normalLoader();
      }
    }

    return content;
  }

  // 解析源码
  parse(source, parentPath) {
    const ast = parse(source);
    // const ast = babylon.parse(source);
    // console.log("----- ast -----", ast);
    // 依赖数组
    const dependencies = [];

    traverse(ast, {
      CallExpression(p) {
        const node = p.node;
        if (node.callee.name === 'require') {
          node.callee.name = '__webpack_require__';
          // 模块的引用名字
          let moduleName = node.arguments[0].value;
          moduleName = moduleName + (path.extname(moduleName) ? '' : '.js');
          moduleName = './' + path.join(parentPath, moduleName);
          // 找到模块名称 放入 dependencies
          dependencies.push(moduleName);
          node.arguments = [t.stringLiteral(moduleName)];
        }
      },
    });

    const sourceCode = generator(ast).code;

    return {
      sourceCode,
      dependencies,
    };
  }

  // 构建模块
  buildModule(modulePath, isEntry) {
    // 获取模块id
    const moduleName = './' + path.relative(this.root, modulePath);
    // console.log(source, moduleName, path.dirname(moduleName));
    if (this.cachedModule[moduleName]) {
      return this.cachedModule[moduleName];
    }
    this.cachedModule[moduleName] = moduleName;

    // 获取模块内容
    const source = this.getSource(modulePath);

    if (isEntry) {
      // 保存入口名字
      this.entryId = moduleName;
    }

    const { sourceCode, dependencies } = this.parse(
      source,
      path.dirname(moduleName)
    );

    // console.log(sourceCode, dependencies);

    // 映射 相对路径和模块内容
    this.modules[moduleName] = sourceCode;

    // 递归 附模块的加载
    dependencies.forEach((dep) => {
      this.buildModule(path.join(this.root, dep), false);
    });
  }

  // 发射文件
  emitFile() {
    // 获取到输出目录
    const main = path.join(
      this.config.output.path,
      this.config.output.filename
    );

    const tempStr = this.getSource(path.join(__dirname, 'main.ejs'));
    const code = ejs.render(tempStr, {
      entryId: this.entryId,
      modules: this.modules,
    });

    this.assets = {};
    // 路径对应的代码
    this.assets[main] = code;

    fs.writeFileSync(main, this.assets[main]);
  }

  run() {
    // 调用 hook
    this.hooks.run.call();
    this.hooks.compile.call();

    // 创建模块依赖关系
    this.buildModule(path.resolve(this.root, this.entry), true /** 主模块 */);
    this.hooks.afterCompile.call();

    // 发射打包后的文件
    this.emitFile();

    this.hooks.emit.call();
    this.hooks.done.call();
  }
}

module.exports = Compiler;
