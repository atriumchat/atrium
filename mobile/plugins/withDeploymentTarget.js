const { withPodfile } = require('expo/config-plugins');

// Xcode 27 rejects old minimum versions even on privacy/resource bundle targets.
module.exports = function withDeploymentTarget(config) {
  return withPodfile(config, (result) => {
    const marker = '# Gomex: align dependency resource bundles with the RN minimum';
    // Remove an earlier generated block when rerunning prebuild after an update.
    result.modResults.contents = result.modResults.contents.replace(/ {4}# Gomex: align dependency resource bundles with the RN minimum[\s\S]*?\n {4}end\n/g, '');
    const hook = 'post_install do |installer|';
    if (!result.modResults.contents.includes(hook)) throw new Error('Missing CocoaPods post_install hook');
    result.modResults.contents = result.modResults.contents.replace(hook, `${hook}
    ${marker}
    installer.pods_project.targets.each do |target|
      required_minimum = '15.1'
      target.build_configurations.each do |build_config|
        minimum = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if minimum && minimum.match?(/\\A\\d+(\\.\\d+)*\\z/) && Gem::Version.new(minimum) < Gem::Version.new(required_minimum)
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = required_minimum
        end
      end
    end
`);
    return result;
  });
};
