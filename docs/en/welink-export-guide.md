# Huawei Welink Chat Record Import Guide

## Overview

ChatLab supports importing chat records from Huawei Welink. The TXT format files exported from Welink can be directly recognized and parsed by ChatLab.

## File Format

**Format Identifier**: `Huawei Welink TXT Format`  
**File Extension**: `.txt`  
**Priority**: 40 (lower than LINE and other TXT formats to prevent misidentification)

### Format Characteristics

```
Nickname(ID)\tYYYY-MM-DD HH:mm:ss
Message content (can be multi-line)
Nickname(ID)\tYYYY-MM-DD HH:mm:ss
Message content
```

**Key Elements:**
- **Message Header**: Format is `Nickname(ID)\tTimestamp`
- **ID Format**: First letter + 8 digits (e.g., `z00123456`, `l00123457`)
- **Timestamp**: `YYYY-MM-DD HH:mm:ss` format
- **Separator**: Tab character (`\t`)
- **Message Content**: Following the message header, supports multiple lines
- **Group Name**: Automatically extracted from filename (removing `.txt` extension)

### Example

```
Alice(z00123456)	2026-03-31 09:15:32
Good morning everyone!
Bob(l00123457)	2026-03-31 09:16:45
Morning, nice weather today
Charlie(w00123458)	2026-03-31 09:17:23
Good morning!
Alice(z00123456)	2026-03-31 10:20:18
[File] API Documentation v2.0.pdf
Bob(l00123457)	2026-03-31 10:21:55
Got it, thanks!
Alice(z00123456)	2026-03-31 11:05:45
[Image]
```

## How to Export Welink Chat Records

### Steps

1. **Open Welink Application**
   - Launch Huawei Welink on PC or mobile

2. **Navigate to Target Chat**
   - Select the group chat or private conversation to export

3. **Access Chat History/Export Function**
   - PC: Right-click on chat → Export Chat Record
   - Mobile: Long-press chat → More Options → Export Chat Record
   - (Menu location may vary by version)

4. **Select TXT Format**
   - Choose TXT format from export format options
   - Confirm export scope (All/Time Range)

5. **Complete Export**
   - File will be saved locally
   - Default filename is the group name or conversation object name

### User Permission Requirements

- **Group Owner/Admin**: Can export all chat records
- **Regular Members**: 
  - Can export chat records visible to them
  - Some enterprise versions may restrict export functionality
  - Consult your enterprise IT administrator for specific permissions

## ChatLab Import Process

### Method 1: Drag and Drop

1. Open ChatLab
2. Drag the Welink exported `.txt` file to the import area
3. Format is automatically recognized and import preview is displayed
4. Click "Analyze New Chat" to complete import

### Method 2: File Selection

1. Open ChatLab
2. Click on "Click to select or drag files to import" area
3. Select Welink TXT file in the file browser
4. Click "Analyze New Chat" to complete import

### Data After Import

After successful import, ChatLab recognizes the following information:

| Field | Description |
|-------|-------------|
| **Group Name** | Extracted from filename |
| **Members** | Identified from message headers (nickname + ID) |
| **Messages** | Include timestamp, sender, content |
| **Message Type** | Automatically identifies special messages (images, files, etc.) |

## Special Message Recognition

ChatLab automatically recognizes the following special message markers:

| Marker | Message Type | Description |
|--------|------------|-------------|
| `[图片]` / `[Image]` | Image | Image message from Welink |
| `[文件]` / `[File]` | File | File message from Welink |
| `[语音]` / `[Voice]` | Audio | Audio message from Welink |
| `[视频]` / `[Video]` | Video | Video message from Welink |

## Frequently Asked Questions

### Q: Getting "Permission Denied" error during export?

**A:** Please check:
1. Are you a group owner or admin? (Regular members may not export all records)
2. Has your organization disabled export functionality?
3. Contact your enterprise IT administrator

### Q: Exported TXT file is very large?

**A:** ChatLab supports large file processing. If the exported file is especially large (>500MB):
1. Consider exporting in batches by time range
2. Or wait for ChatLab to finish loading (may take a few seconds)

### Q: Some message content is missing?

**A:** Possible reasons:
1. Some special content types (red packets, cards, etc.) cannot be exported as plain text by Welink
2. Group owner has restricted message visibility
3. Certain message types are filtered during export

### Q: How can I export only a specific time range?

**A:** In the Welink export dialog:
1. Select "Custom Range" option
2. Set start and end dates
3. Complete export

### Q: Some members are missing after import?

**A:** Usual reasons:
1. These members didn't send messages during the export time range
2. ChatLab only records information for members who have sent messages

## Data Privacy

- All data processing in ChatLab is done **locally on your device**
- Imported chat records are stored only on your local device
- Data security is guaranteed by your device's security policies

## Feedback and Support

If you encounter issues exporting or importing Welink chat records:
- Verify the file format is correct
- Check error messages in the import preview
- If problems persist, please report on GitHub Issues with:
  - Error message
  - Sample data (anonymized)
  - ChatLab version number
