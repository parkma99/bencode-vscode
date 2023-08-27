import * as vscode from "vscode";
import * as bencode from "./bencode";

interface BencodeDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}
interface RecordOf<T> {
  [_: string]: T;
}

type EncodeInTypes =
  | number
  | Uint8Array
  | Array<EncodeInTypes>
  | Map<any, EncodeInTypes>;
type EncodeOutTypes =
  | number
  | string
  | Array<EncodeOutTypes>
  | RecordOf<EncodeOutTypes>;

function tryEncodeHexstring(data: ArrayBuffer): string {
  const isValidUtf8String = (str: string): boolean => {
    const replacementChar = "\uFFFD"; // U+FFFD REPLACEMENT CHARACTER
    return !str.includes(replacementChar);
  };

  const encodeToHexstring = (buf: Buffer): string => {
    // example: <hex>0A 0B 0C ...</hex>
    const hexStr = buf.toString("hex").toUpperCase();

    let str = "<hex>";
    for (let i = 0; i < hexStr.length; i += 2) {
      str += hexStr.substring(i, i+2) + " ";
    }
    str = `${str.trimEnd()}</hex>`;
    return str;
  };

  const str = data.toString();
  return isValidUtf8String(str) ? str : encodeToHexstring(Buffer.from(data));
}
function encodeToArray(data: Array<EncodeInTypes>): Array<EncodeOutTypes> {
  const ret = [];

  for (const val of data) {
    if (typeof val === "number") {
      ret.push(val);
    } else if (val instanceof Uint8Array) {
      ret.push(tryEncodeHexstring(val));
    } else if (val instanceof Array) {
      ret.push(encodeToArray(val));
    } else if (val instanceof Map) {
      ret.push(encodeToObject(val));
    } else {
      //throw new Error("Type unhandled: " + typeof val + "\nValue: " + val);
    }
  }

  return ret;
}

function encodeToObject(
  data: Map<Buffer, EncodeInTypes>
): Record<string, EncodeOutTypes> {
  const ret: ReturnType<typeof encodeToObject> = {};

  for (const [key, val] of data) {
    const keyString = tryEncodeHexstring(key);

    if (typeof val === "number") {
      ret[keyString] = val;
    } else if (val instanceof Uint8Array) {
      ret[keyString] = tryEncodeHexstring(val);
    } else if (val instanceof Array) {
      ret[keyString] = encodeToArray(val);
    } else if (val instanceof Map) {
      ret[keyString] = encodeToObject(val);
    } else {
      //throw new Error("Type unhandled: " + typeof val + "\nValue: " + val);
    }
  }

  return ret;
}

class BencodeDocument implements vscode.CustomDocument {
  static async create(
    uri: vscode.Uri,
    backupId: string | undefined
  ): Promise<BencodeDocument | PromiseLike<BencodeDocument>> {
    // If we have a backup, read that. Otherwise read the resource from the workspace
    const dataFile =
      typeof backupId === "string" ? vscode.Uri.parse(backupId) : uri;
    const fileData = await BencodeDocument.readFile(dataFile);
    return new BencodeDocument(uri, fileData);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === "untitled") {
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  uri: vscode.Uri;
  private documentData: Uint8Array;
  private decodedData: Map<Buffer, EncodeInTypes>;
  dispose(): void {
    throw new Error("Method not implemented.");
  }
  private constructor(uri: vscode.Uri, initialContent: Uint8Array) {
    this.uri = uri;
    this.documentData = initialContent;
    this.decodedData = bencode.decode(Buffer.from(this.documentData));
  }
  public getDecodedData(): string {
	const obj = encodeToObject(this.decodedData);
    return JSON.stringify(obj, null, 3);
  }
}

/**
 * Provider for bencode file editors.
 */
export class BencodeEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      BencodeEditorProvider.viewType,
      new BencodeEditorProvider(context)
    );
    return providerRegistration;
  }

  private static readonly viewType = "bencode.preview";

  constructor(private readonly context: vscode.ExtensionContext) {}
  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<BencodeDocument> {
    const document: BencodeDocument = await BencodeDocument.create(
      uri,
      openContext.backupId
    );
    return document;
  }
  resolveCustomEditor(
    document: BencodeDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
       // Setup initial content for the webview
    	webviewPanel.webview.options = {
    		enableScripts: true,
    	};
		const result = document.getDecodedData();
    	webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, result);
  }

  /**
   * Get the static html used for the editor webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview, str: string): string {
  	// Local path to script and css for the webview
  	// const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
  	// 	this.context.extensionUri, 'media', 'catScratch.js'));

  	// const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
  	// 	this.context.extensionUri, 'media', 'reset.css'));

  	// const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
  	// 	this.context.extensionUri, 'media', 'vscode.css'));

  	// const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
  	// 	this.context.extensionUri, 'media', 'catScratch.css'));
  	return /* html */`
  		<!DOCTYPE html>
  		<html lang="en">
  		<head>
  			<meta charset="UTF-8">

  			<!--
  			Use a content security policy to only allow loading images from https or from our extension directory,
  			and only allow scripts that have a specific nonce.
  			-->
  			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource};">

  			<meta name="viewport" content="width=device-width, initial-scale=1.0">

  			<title>Cat Scratch</title>
  		</head>
  		<body>
  			<div class="notes">
  				<div>
				${str}
  				</div>
  			</div>
  		</body>
  		</html>`;
  }
}
