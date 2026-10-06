package dev.amll.hub.android.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dev.amll.hub.android.data.local.AuthStore
import dev.amll.hub.android.data.remote.AuthApi
import dev.amll.hub.android.data.remote.NetworkModule
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideAuthStore(@ApplicationContext context: Context): AuthStore = AuthStore(context)

    @Provides
    @Singleton
    fun provideNetworkModule(authStore: AuthStore): NetworkModule = NetworkModule(authStore)

    @Provides
    @Singleton
    fun provideAuthApi(network: NetworkModule): AuthApi = network.authApi
}
