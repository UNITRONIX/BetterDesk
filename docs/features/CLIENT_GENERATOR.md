# RustDesk Client Generator

## Overview

The Client Generator is an integrated feature of the BetterDesk Console that allows you to create custom RustDesk clients with pre-configured settings. This eliminates the need for users to manually configure their clients and ensures consistent deployment across your organization.

## Features

### Platform Support
- **Windows 64-bit** - Standard Windows desktop client
- **Windows 32-bit** - Legacy Windows systems
- **Linux** - AppImage for universal Linux compatibility
- **Android** - APK for Android devices
- **macOS** - DMG installer for Apple devices

### Configuration Options

#### General Settings
- Custom configuration name
- Custom application name
- Connection type (Incoming, Outgoing, Bidirectional)
- Enable/disable installation
- Enable/disable settings menu
- Custom Android App ID

#### Custom Server
- Pre-configure server host
- Embed public key
- Set API endpoint
- Custom branding URLs
- Company copyright information

#### Security
- Password approval mode
- Permanent password
- LAN discovery control
- Direct IP access
- Auto-close on inactivity
- Hide connection window option

#### Visual Customization
- Custom app icon (.png)
- Custom app logo (.png)
- Theme selection (Follow System, Light, Dark)
- Theme override options

#### Permissions
- Granular control over features:
  - Keyboard/mouse control
  - Clipboard sharing
  - File transfer
  - Audio transmission
  - TCP tunneling
  - Remote restart
  - Session recording
  - Block user input
  - Remote configuration
  - Remote printer
  - Remote camera
  - Remote terminal

#### Code Changes
- Monitor cycling button
- Offline device indicators
- Version notification control

#### Other Options
- Wallpaper removal during sessions
- Default settings (JSON)
- Override settings (JSON)

## How to Use

### 1. Access the Generator
Navigate to "Client Generator" in the sidebar menu of the BetterDesk Console.

### 2. Select Platform
Click on the desired platform icon (Windows, Linux, Android, or macOS).

### 3. Choose Version
Select the RustDesk version you want to customize.

### 4. Configure Settings
Fill in the configuration options based on your requirements:
- Enter server details if using a custom server
- Set security options
- Upload custom icons/logos if desired
- Configure permissions
- Add any custom settings in JSON format

### 5. Generate Client
Click the "Generate Custom Client" button. The system will:
1. Download the base RustDesk client
2. Apply your configuration
3. Package the customized client
4. Provide a download link

### 6. Download and Deploy
Once generation is complete, download the custom client and distribute it to your users.

## Technical Details

### How It Works

1. **Download Base Client**: The generator fetches the official RustDesk client from GitHub releases.

2. **Configuration Injection**: Your settings are converted to RustDesk's configuration format (TOML).

3. **Client Modification**: The configuration is embedded or packaged with the client.

4. **Output Generation**: The customized client is packaged and made available for download.

### File Storage

- Generated clients are stored in `/tmp/rustdesk_builds/`
- Uploaded icons/logos are stored in `/tmp/rustdesk_uploads/`
- Files older than 24 hours are automatically cleaned up

### Security

- Only authenticated users can access the generator
- All actions are logged in the audit log
- File uploads are restricted to .png format
- Maximum file size: 5MB
- Filenames are sanitized to prevent directory traversal

## Configuration Format

### Default Settings (JSON)
```json
{
  "view_style": "original",
  "scroll_style": "scrollauto",
  "image_quality": "balanced"
}
```

### Override Settings (JSON)
```json
{
  "options": {
    "enable-audio": "N",
    "enable-clipboard": "Y"
  }
}
```

## Limitations

### Current Implementation
The current implementation provides basic configuration embedding. For production use, consider:

1. **Code Signing**: Sign the executables with your organization's certificate
2. **Advanced Customization**: Modify source code for deeper changes
3. **Branding**: Replace icons and resources in the executable
4. **Compilation**: Build from source for maximum customization

### Platform-Specific Notes

- **Windows**: Configuration can be embedded as a companion .toml file
- **Linux**: AppImage allows configuration overlay
- **Android**: APK modification requires signing with your certificate
- **macOS**: DMG modification may require code signing

## Best Practices

1. **Test First**: Always test generated clients in a safe environment before deployment
2. **Version Control**: Keep track of which configurations you've deployed
3. **Security**: Use strong permanent passwords if enabling this feature
4. **Permissions**: Only grant minimum necessary permissions
5. **Updates**: Regularly generate new clients with latest RustDesk versions

## Troubleshooting

### Generation Fails
- Check internet connection (required to download base clients)
- Verify RustDesk version is available on GitHub
- Check disk space in `/tmp/`

### Client Doesn't Connect
- Verify server host is correct
- Check public key matches your server
- Ensure firewall allows required ports

### Configuration Not Applied
- Verify JSON syntax in default/override settings
- Check that settings keys are valid
- Review generated metadata file (.json)

## API Integration

The generator can be accessed programmatically:

### Generate Client
```bash
POST /api/generate-client
Authorization: Bearer <token>
Content-Type: multipart/form-data

# Form fields: platform, version, config_name, server_host, etc.
```

### Download Client
```bash
GET /api/download-client/<filename>
Authorization: Bearer <token>
```

## Future Enhancements

Planned improvements:
- Source code compilation for full customization
- Code signing integration
- Batch generation for multiple platforms
- Configuration templates
- Version tracking and rollback
- Client update management

### Native client scope

The current onboarding path uses generated RustDesk packages with BetterDesk
server settings embedded or supplied through the configuration QR/deploy
string. A separate BetterDesk-native Windows or Android client is not implied
by this generator and must be planned as its own product scope.

Before implementation, that scope must define the supported platforms and
architectures, remote-control and enrollment flows, signing and update
infrastructure, server trust and authentication model, data collection,
distribution, and compatibility requirements. No unsigned or unreviewed
client binary should be introduced through the panel generator.

## Support

For issues or questions about the Client Generator:
1. Check the main BetterDesk Console documentation
2. Review RustDesk official documentation
3. Submit issues on the project repository

## Credits

This generator integrates with [RustDesk](https://github.com/rustdesk/rustdesk), an open-source remote desktop software.
