/**
 * VeriFace Edge Mobile — Branded Splash Screen
 *
 * Shows the VeriFace Edge logo + brand gradient on app launch.
 * Replaces the default white Expo splash with a premium branded experience.
 *
 * Uses expo-splash-screen to control hide timing — the native splash
 * (configured in app.json) shows first, then this component provides
 * a smooth transition into the app.
 */

import React, { useEffect, useRef } from 'react'
import { View, Animated, Easing, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as SplashScreen from 'expo-splash-screen'
import { VeriFaceLogo } from './VeriFaceLogo'

SplashScreen.preventAutoHideAsync().catch(() => {})

export function BrandedSplash({ onAnimationComplete }: { onAnimationComplete?: () => void }) {
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.8)).current
  const textAnim = useRef(new Animated.Value(0)).current
  const loaderAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Sequence: logo fades in + scales up → text fades in → loader slides → complete
    Animated.sequence([
      // Logo entrance
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
      ]),
      // Text fade in
      Animated.timing(textAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
      // Loader animation
      Animated.timing(loaderAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      }),
    ]).start(() => {
      // Hide native splash + notify app
      SplashScreen.hideAsync().catch(() => {})
      onAnimationComplete?.()
    })
  }, [])

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0f172a', '#1e1b4b']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.background}
      >
        {/* Glow orb */}
        <View style={styles.glowOrb} />

        {/* Logo */}
        <Animated.View style={{
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
          alignItems: 'center',
        }}>
          <VeriFaceLogo variant="mark" size={100} />

          <Animated.View style={{ opacity: textAnim, alignItems: 'center' }}>
            <View style={styles.textContainer}>
              <Text style={styles.title}>
                VeriFace
                <Text style={styles.titleAccent}> Edge</Text>
              </Text>
              <Text style={styles.subtitle}>Admin Console</Text>
            </View>
          </Animated.View>

          <Animated.View style={{ opacity: textAnim }}>
            <Text style={styles.tagline}>
              Privacy-First Facial Authentication
            </Text>
          </Animated.View>
        </Animated.View>

        {/* Loader bar */}
        <Animated.View style={[styles.loaderContainer, { opacity: textAnim }]}>
          <View style={styles.loaderTrack}>
            <Animated.View
              style={[
                styles.loaderBar,
                {
                  transform: [{
                    translateX: loaderAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-120, 120],
                    }),
                  }],
                },
              ]}
            />
          </View>
        </Animated.View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>v1.0.0 · © 2026 VeriFace Edge</Text>
        </View>
      </LinearGradient>
    </View>
  )
}

// Need Text import
import { Text } from 'react-native'

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
  },
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowOrb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    top: '25%',
  },
  textContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#f1f5f9',
    letterSpacing: -0.5,
  },
  titleAccent: {
    color: '#10b981',
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginTop: 4,
    fontWeight: '500',
  },
  tagline: {
    fontSize: 12,
    color: '#475569',
    marginTop: 24,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  loaderContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  loaderTrack: {
    width: 120,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  loaderBar: {
    width: 48,
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    color: '#334155',
  },
})
