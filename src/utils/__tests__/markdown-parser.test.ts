import { describe, it, expect } from 'vitest';
import {
  findActiveBlockAtLine,
  findCommentedBlockAtLine,
  parseImageLink,
  formatCommentedBlock,
  findMermaidBlockAtLine,
  getCodeHash,
  injectThemeDirective,
  stripInjectedTheme
} from '../markdown-parser';


describe('Markdown Parser', () => {
  describe('parseImageLink', () => {
    it('should parse wiki-style image links correctly', () => {
      const match = parseImageLink('![[attachments/mermaid-123.png]]');
      expect(match).not.toBeNull();
      expect(match!.path).toBe('attachments/mermaid-123.png');
      expect(match!.isRemote).toBe(false);
    });

    it('should parse wiki-style image links with alt or width text', () => {
      const match = parseImageLink('![[mermaid-123.png|300]]');
      expect(match).not.toBeNull();
      expect(match!.path).toBe('mermaid-123.png');
      expect(match!.isRemote).toBe(false);
    });

    it('should parse standard markdown image links correctly', () => {
      const match = parseImageLink('![alt text](images/diagram.png)');
      expect(match).not.toBeNull();
      expect(match!.path).toBe('images/diagram.png');
      expect(match!.isRemote).toBe(false);
    });

    it('should identify remote URLs as remote', () => {
      const match = parseImageLink('![](https://cdn.example.com/diagram.png)');
      expect(match).not.toBeNull();
      expect(match!.path).toBe('https://cdn.example.com/diagram.png');
      expect(match!.isRemote).toBe(true);
    });

    it('should parse commented-out image links correctly', () => {
      const matchWiki = parseImageLink('%% ![[mermaid-123.png]] %%');
      expect(matchWiki).not.toBeNull();
      expect(matchWiki!.path).toBe('mermaid-123.png');
      expect(matchWiki!.isCommented).toBe(true);

      const matchMd = parseImageLink('%% ![](https://cdn.example.com/diagram.png) %%');
      expect(matchMd).not.toBeNull();
      expect(matchMd!.path).toBe('https://cdn.example.com/diagram.png');
      expect(matchMd!.isCommented).toBe(true);
    });

    it('should return null for non-image links', () => {
      expect(parseImageLink('[Link](image.png)')).toBeNull();
      expect(parseImageLink('![[document.pdf]]')).not.toBeNull(); // PDF is also an embed, but let's see. In our case it parses it.
      expect(parseImageLink('plain text')).toBeNull();
    });
  });

  describe('findActiveBlockAtLine', () => {
    it('should find active block when cursor is on the opening tag', () => {
      const lines = [
        '# Note Title',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        'some text'
      ];
      const block = findActiveBlockAtLine(lines, 1);
      expect(block).not.toBeNull();
      expect(block!.type).toBe('active');
      expect(block!.startLine).toBe(1);
      expect(block!.endLine).toBe(4);
      expect(block!.code).toBe('graph TD\n  A --> B');
    });

    it('should find active block when cursor is inside the code block', () => {
      const lines = [
        '# Note Title',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        'some text'
      ];
      const block = findActiveBlockAtLine(lines, 2);
      expect(block).not.toBeNull();
      expect(block!.code).toBe('graph TD\n  A --> B');
    });

    it('should find active block when cursor is on the closing tag', () => {
      const lines = [
        '# Note Title',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        'some text'
      ];
      const block = findActiveBlockAtLine(lines, 4);
      expect(block).not.toBeNull();
      expect(block!.startLine).toBe(1);
      expect(block!.endLine).toBe(4);
    });

    it('should return null if cursor is outside any code block', () => {
      const lines = [
        '# Note Title',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        'some text'
      ];
      expect(findActiveBlockAtLine(lines, 0)).toBeNull();
      expect(findActiveBlockAtLine(lines, 5)).toBeNull();
    });

    it('should detect an existing image link immediately following the active block', () => {
      const lines = [
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        '![[mermaid-123.png]]'
      ];
      const block = findActiveBlockAtLine(lines, 1);
      expect(block).not.toBeNull();
      expect(block!.existingImageLink).toBe('![[mermaid-123.png]]');
      expect(block!.existingImagePath).toBe('mermaid-123.png');
      expect(block!.imageLinkLine).toBe(4);
      expect(block!.isExistingImageRemote).toBe(false);
    });

    it('should detect a remote image link following the active block', () => {
      const lines = [
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        '![](https://cdn.example.com/diagram.png)'
      ];
      const block = findActiveBlockAtLine(lines, 1);
      expect(block).not.toBeNull();
      expect(block!.existingImageLink).toBe('![](https://cdn.example.com/diagram.png)');
      expect(block!.existingImagePath).toBe('https://cdn.example.com/diagram.png');
      expect(block!.imageLinkLine).toBe(4);
      expect(block!.isExistingImageRemote).toBe(true);
    });
  });

  describe('findCommentedBlockAtLine', () => {
    const commentedBlockLines = [
      '# Document Title',
      '%% [Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line]',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '[Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line] %%',
      '![[attachments/mermaid-abc.png]]',
      'other normal content'
    ];

    it('should find commented block when cursor is on warning line', () => {
      const block = findCommentedBlockAtLine(commentedBlockLines, 1);
      expect(block).not.toBeNull();
      expect(block!.type).toBe('commented');
      expect(block!.startLine).toBe(1);
      expect(block!.endLine).toBe(6);
      expect(block!.code).toBe('graph TD\n  A --> B');
      expect(block!.existingImageLink).toBe('![[attachments/mermaid-abc.png]]');
      expect(block!.existingImagePath).toBe('attachments/mermaid-abc.png');
      expect(block!.imageLinkLine).toBe(7);
    });

    it('should find commented block when cursor is inside the code block', () => {
      const block = findCommentedBlockAtLine(commentedBlockLines, 3);
      expect(block).not.toBeNull();
      expect(block!.code).toBe('graph TD\n  A --> B');
    });

    it('should find commented block when cursor is on the image link line below it', () => {
      const block = findCommentedBlockAtLine(commentedBlockLines, 7);
      expect(block).not.toBeNull();
      expect(block!.type).toBe('commented');
      expect(block!.code).toBe('graph TD\n  A --> B');
    });

    it('should return null if cursor is completely outside the commented block range', () => {
      expect(findCommentedBlockAtLine(commentedBlockLines, 0)).toBeNull();
      expect(findCommentedBlockAtLine(commentedBlockLines, 8)).toBeNull();
    });

    it('should find commented block with remote image link', () => {
      const lines = [
        '%% [Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line]',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        '[Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line] %%',
        '![](https://cdn.example.com/diagram.png)'
      ];
      const block = findCommentedBlockAtLine(lines, 2);
      expect(block).not.toBeNull();
      expect(block!.existingImageLink).toBe('![](https://cdn.example.com/diagram.png)');
      expect(block!.existingImagePath).toBe('https://cdn.example.com/diagram.png');
      expect(block!.imageLinkLine).toBe(6);
      expect(block!.isExistingImageRemote).toBe(true);
    });
  });

  describe('findMermaidBlockAtLine unified helper', () => {
    it('should prioritize commented blocks over active blocks if inside both somehow, or detect active', () => {
      const lines = [
        '```mermaid',
        'graph TD',
        '```'
      ];
      const block = findMermaidBlockAtLine(lines, 1);
      expect(block).not.toBeNull();
      expect(block!.type).toBe('active');
    });
  });

  describe('formatCommentedBlock', () => {
    it('should output the warning line, code block, closing warning line, and image link correctly', () => {
      const code = 'graph TD\n  A --> B';
      const imgLink = '![[mermaid-abc.png]]';
      const result = formatCommentedBlock(code, imgLink);

      const expected = [
        '%% [Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line]',
        '```mermaid',
        'graph TD',
        '  A --> B',
        '```',
        '[Autogenerated by Mermaid Block to Image Plugin. Do not delete or modify this line] %%',
        '![[mermaid-abc.png]]'
      ].join('\n');

      expect(result).toBe(expected);
    });
  });

  describe('getCodeHash', () => {
    it('should generate a consistent 8-character hex hash', async () => {
      const code = 'graph TD\n  A --> B';
      const hash1 = await getCodeHash(code);
      const hash2 = await getCodeHash(code);

      expect(hash1).toHaveLength(8);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should generate different hashes for different text', async () => {
      const hash1 = await getCodeHash('graph TD\n  A --> B');
      const hash2 = await getCodeHash('graph TD\n  A --> C');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('theme directive helpers', () => {
    describe('injectThemeDirective', () => {
      it('should inject theme directive if none is present', () => {
        const code = 'graph TD\n  A --> B';
        const result = injectThemeDirective(code, 'dark');
        expect(result).toBe("%%{init: {'theme': 'dark'}}%%\ngraph TD\n  A --> B");
      });

      it('should not inject if code already has %%{init: directive', () => {
        const code = "%%{init: {'theme': 'forest'}}%%\ngraph TD\n  A --> B";
        const result = injectThemeDirective(code, 'dark');
        expect(result).toBe(code);
      });

      it('should not inject if code contains %%{init} directive', () => {
        const code = "%%{init}%%\ngraph TD\n  A --> B";
        const result = injectThemeDirective(code, 'dark');
        expect(result).toBe(code);
      });

      it('should be case-insensitive and spacing tolerant when checking for existing init blocks', () => {
        const code = "%%  {  init  : { ... } } %%\ngraph TD";
        const result = injectThemeDirective(code, 'dark');
        expect(result).toBe(code);
      });

      it('should inject after YAML frontmatter if present', () => {
        const code = "---\ntitle: Simple Flow\n---\ngraph TD\n  A --> B";
        const result = injectThemeDirective(code, 'dark');
        expect(result).toBe("---\ntitle: Simple Flow\n---\n%%{init: {'theme': 'dark'}}%%\ngraph TD\n  A --> B");
      });
    });

    describe('stripInjectedTheme', () => {
      it('should strip injected theme directive', () => {
        const code = "%%{init: {'theme': 'dark'}}%%\ngraph TD\n  A --> B";
        const result = stripInjectedTheme(code);
        expect(result).toBe("graph TD\n  A --> B");
      });

      it('should strip theme directive with double quotes or different themes', () => {
        const code = '%%{init: {"theme": "forest"}}%%\ngraph TD\n  A --> B';
        const result = stripInjectedTheme(code);
        expect(result).toBe("graph TD\n  A --> B");
      });

      it('should not strip standard custom user init blocks', () => {
        const code = "%%{init: {'theme': 'custom-theme-name'}}%%\ngraph TD";
        const result = stripInjectedTheme(code);
        expect(result).toBe(code);
      });

      it('should strip injected theme directive even when placed after frontmatter', () => {
        const code = "---\ntitle: Simple Flow\n---\n%%{init: {'theme': 'dark'}}%%\ngraph TD\n  A --> B";
        const result = stripInjectedTheme(code);
        expect(result).toBe("---\ntitle: Simple Flow\n---\ngraph TD\n  A --> B");
      });
    });
  });
});

